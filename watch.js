var WebSocket = require('ws'),
	EventEmitter = require('events').EventEmitter,
	util = require('util'),
	package = require('./package.json');

var NORMAL = 0,
	IGNORE_NEXT_STREAM = 1,
	IGNORED_STREAM = 2,
	STREAMING = 3;


function FirebaseWatcher(opts) {
	EventEmitter.call(this);
	this.debug = opts.debug;
	this.db = opts.db;
	this.auth = opts.auth;
	this.host = opts.host;
	this.req = 0;
	this.reply = {};
	this.watches = {};
	this.watchCount = 0;
	this.resolvedWatches = {};
	this.reconnectDelay = opts.reconnectDelay || 1000;
}

util.inherits(FirebaseWatcher, EventEmitter);

FirebaseWatcher.prototype.connect = function() {
	var self = this;
	if (!self.host) self.host = self.db + '.firebaseio.com';

	self.ws = new WebSocket('wss://' + self.host + '/.ws?v=5&ns=' + self.db);
	
	self.ws.on('close', function() {
		self.emit('disconnected');
		self._loggedIn = false;
		if (!this._redirecting) {
			clearInterval(self._keepalive);
			self.resolvedWatches = {};
			setTimeout(function() {
				self.connect();
			}, self.reconnectDelay);
		}
	});

	self.ws.on('open', function() {
		self.emit('connected');
	});

	self.ws.on('error', function(err) {
		self.close();
		setTimeout(function() {
			self.connect();
		}, self.reconnectDelay);
	});


	self.ws.on('message', function(msg) {

		if (!isNaN(msg)) {
			if (self.state == IGNORE_NEXT_STREAM) {
				self.log('S: IGNORED_STREAM');
				self.state = IGNORED_STREAM;
			} else {
				self.log('S: STREAMING');
				self.state = STREAMING;
			}
			self.frames = parseInt(msg, 10);
			self.received = 0;
			self.buf='';
			self.log('...' + self.frames + ' frames');
		} else {

			if (self.state == IGNORED_STREAM) {
				++self.received;
				if (self.received == self.frames) {
					self.log('got all frames, ' + self.watchReqs + ' to go');
					if (self.watchReqs > 0) {
						self.log('S: IGNORE_NEXT_STREAM');
						self.state = IGNORE_NEXT_STREAM;
					} else {
						self.log('S: NORMAL');
						self.state = NORMAL;
					}
				}
			} else if (self.state == STREAMING) {
				++self.received;
				self.buf += msg;
				if (self.received == self.frames) {
					self.log('NORMAL 2');
					if (self.watchReqs > 0) {
						self.log('S: IGNORE_NEXT_STREAM');
						self.state = IGNORE_NEXT_STREAM;
					} else {
						self.state = NORMAL;
						self.log('S: NORMAL');
					}
					handleMessage(self.buf);
					self.buf = null;
				}
			} else {
				handleMessage(msg);
			}
			
		}
	});

	function handleMessage(msg) {

		var len = msg.length;

		msg = JSON.parse(msg);

		if (self.debug) {
			process.stdout.write('RECV ');

			if (len < 1024) {
				console.dir(msg, { depth: null });
			} else {
				console.log(+ len + ' bytes');
			}
		}

		switch (msg.t) {
			case 'c': // control message
				switch (msg.d.t) {
					case 'r': // RESET - redirect to different server
						self.ws._redirecting = true;
						self.close();
						self.host = msg.d.d;
						self.connect();
						break;
					case 'h': // HELLO - should be first message recieved
						var outMsg = {
							t: 'd',
							d: {
								r: ++self.req, // 1
								a: 's',
								b: {
									c: {
										// version goes here
									}
								}
							}
						};
						outMsg.d.b.c['firewatch-' + package.version.replace(/\./g, '-')] = 1;
						self._send(outMsg, function(msg) {
							if (msg.d.b.s == 'ok') {
								self._send({
									t: 'c',
									d: {
										t: 'p',
										d: {}
									}
								});
							} else {
								var err = new Error('Handshake failed');
								err.msg = msg;
								self.emit('error', err);
							}
						});
						break;

					case 'o': // PONG - usually response to t:c msg sent after req 1
						self._send({
							t: 'd',
							d: {
								r: ++self.req,
								a: 'auth',
								b: {
									cred: self.auth
								}
							}
						}, function(msg) {
							if (msg.d.b.s == 'ok') {
								self._keepalive = setInterval(sendKeepalive, 45000, self);
								self._loggedIn = true;
								self._requestPaths();
							} else {
								var err = new Error('Auth failed');
								err.msg = msg;
								self.emit('error', err);
							}
						});
						break;

					case 'e': // ERROR
						self.emit('serverError', msg.d.d);
						break;

					case 's': // SHUTDOWN
						self.emit('serverShutdown', msg.d.d);
						self.close();
						break;
					default:
						self.emit('warning', {
							type: 'unknown-control',
							msg: msg
						});
				}
				break;
			case 'd': // data message
				if (msg.d.r) {
					handleReply(self, msg);
				} else if (msg.d.a == 'd' || msg.d.a == 'm') {
					if (self.state == IGNORE_NEXT_STREAM) {
						self.log('msg, ' + self.watchReqs + ' to go');
					} else {
						handleUpdate(self, msg.d.b.p, msg.d.b.d);
					}
				}
				break;
		}

	}
};

FirebaseWatcher.prototype.close = function() {
	this._loggedIn = false;
	clearInterval(this._keepalive);
	this.resolvedWatches = {};
	this.ws.close();
};

FirebaseWatcher.prototype._send = function(msg, cb) {
	if (cb) {
		this.reply[msg.d.r] = cb;
	}
	if (this.debug) {
		process.stdout.write('SEND ');
		console.dir(msg, { depth: null });
	}
	msg = JSON.stringify(msg);
	this.ws.send(msg);
};

FirebaseWatcher.prototype._requestPaths = function() {
	var self = this;

	self._syncing = true;

	self.watchReqs = 0;
	self.log('S: IGNORE_NEXT_STREAM');
	self.state = IGNORE_NEXT_STREAM;

	var resolvedWatches = {};

	self.log('CURRENT:', self.resolvedWatches);

	check(self.watches, ['']);

	function check(level, path) {
		if (level['.cb']) {
			watchOn(path.join('/') || '/');
		} else {
			for (var k in level) {
				check(level[k], path.concat(k));
			}
		}
	}

	function watchOn(path) {
		self.log('watchOn', path);
		resolvedWatches[path] = true;

		if (self.resolvedWatches[path]) {
			self.log('...already have');
			return;
		}

		self.watchReqs++;

		self._send({
			t: 'd',
			d: {
				r: ++self.req,
				a: 'q',
				b: {
					p: path,
					h: ''
				}
			}
		}, function(msg) {
			if (msg.d.b.s != 'ok') {
				var err = new Error('Listen to ' + path + ' failed');
				err.msg = msg;
				self.emit('error', err);
			}

			if (--self.watchReqs == 0) {
				self.log('S: NORMAL');
				self.state = NORMAL;
				self._syncing = false;
				self.emit('ready');
			}
		});
	}


	for (var path in self.resolvedWatches) {
		if (!resolvedWatches[path]) {
			self._send({
				t: 'd',
				d: {
					r: ++self.req,
					a: 'n',
					b: {
						p: path
					}
				}
			}, function(msg) {
				if (msg.d.b.s != 'ok') {
					var err = new Error('Unlisten to ' + path + ' failed');
					err.msg = msg;
					self.emit('error', err);
				}
			});
		}
	}

	self.resolvedWatches = resolvedWatches;

	if (self.watchReqs == 0) {
		self.log('S: NORMAL');
		self.state = NORMAL;
		self._syncing = false;
		self.emit('ready');
	}
};


FirebaseWatcher.prototype.sync = function() {
	var self = this;
	if (self._sync) {
		clearTimeout(self._sync);
	}

	self._sync = setTimeout(function() {
		self._sync = null;
		if (self._loggedIn) {
			if (self._syncing) {
				// in the middle of requestPaths doing its thing; try again later
				self.sync();
			} else {
				self._requestPaths();
			}
		}
	}, 100);
};

FirebaseWatcher.prototype.watch = function(path, cb) {
	if (path[0] == '/') path = path.substr(1);
	path = path.split('/');

	var watch = this.watches;
	for (var i = 0; i < path.length; i++) {
		if (!watch[path[i]]) watch[path[i]] = {};
		watch = watch[path[i]];
	}

	if (!watch['.cb']) watch['.cb'] = [];

	watch['.cb'].push(cb);
	++this.watchCount;

	if (this._loggedIn) {
		// adding a watch after we've already connected
		this.sync();
	}
};

FirebaseWatcher.prototype.watchKeys = function(path, cb) {
	var watcher = function(newData) {
		if (newData && typeof newData == 'object') {
			for (var k in newData) {
				cb(k, newData[k]);
			}
		}
	};

	this.watch(path, watcher);

	return watcher;
};

FirebaseWatcher.prototype.unwatch = function(path, cb) {
	if (path[0] == '/') path = path.substr(1);
	path = path.split('/');

	var watch = this.watches;

	if (cb === true) {

		for (var i = 0; i < path.length - 1; i++) {
			watch = watch[path[i]];
			if (!watch) return;
		}
		delete watch[path[path.length-1]];
		self.watchCount = null;

	} else {

		for (var i = 0; i < path.length; i++) {
			watch = watch[path[i]];
			if (!watch) return;
		}
		if (watch['.cb']) {
			if (typeof cb == 'function') {
				var cbs = watch['.cb'];
				if (cbs.length == 1 && cbs[0] == cb) {
					delete watch['.cb'];
					--self.watchCount;
				} else {
					for (var i = 0; i < cbs.length; i++) {
						if (cbs[i] == cb) {
							cbs.splice(i, 1);
							--self.watchCount;
							break;
						}
					}
				}
			} else {
				delete watch['.cb'];
			}
		}

	}

	this.sync();
};

FirebaseWatcher.prototype.unwatchAll = function() {
	this.watches = {};
	this.watchCount = 0;

	this.sync();
};

FirebaseWatcher.prototype.log = function() {
	if (this.debug) {
		console.log.apply(console, arguments);
	}
}


function sendKeepalive(self) {
	self.ws.send('0');
}


function handleReply(self, msg) {
	self.reply[msg.d.r](msg);
	delete self.reply[msg.d.r];
}

function handleUpdate(self, path, newData) {
	path = path.split('/');


	var obj = {}, level = obj;
	for (var i = 0; i < path.length-1; i++) {
		level = level[path[i]] = {};
	}
	level[path[path.length-1]] = newData;

	check(obj, self.watches);

	function check(obj, watch) {
		for (var k in watch) {
			if (k != '.cb') {
				if (Object.prototype.hasOwnProperty.call(obj, k)) {

					var cbs = watch[k]['.cb'];
					if (cbs) {
						for (var i = 0; i < cbs.length; i++) {
							cbs[i](obj[k]);
						}
					}

					if (obj[k] && typeof obj[k] == 'object') {
						check(obj[k], watch[k]);
					}

				}
			}
		}
	}
}



exports = module.exports = FirebaseWatcher;
