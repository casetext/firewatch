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
	this.db = opts.db;
	this.auth = opts.auth;
	this.host = opts.host;
	this.req = 0;
	this.reply = {};
	this.watches = {};
	this.watchCount = 0;
	this.reconnectDelay = opts.reconnectDelay || 1000;
}

util.inherits(FirebaseWatcher, EventEmitter);

FirebaseWatcher.prototype.connect = function() {
	var self = this;
	if (!self.host) self.host = self.db + '.firebaseio.com';

	self.ws = new WebSocket('wss://' + self.host + '/.ws?v=5&ns=' + self.db);
	
	self.ws.on('close', function() {
		self.emit('disconnected');
		if (!this._redirecting) {
			clearInterval(self._keepalive);
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
				self._rootReceived = Date.now();
				self.emit('serverReady', self._rootReceived - self._rootRequested)
				self.state = IGNORED_STREAM;
			} else {
				self.state = STREAMING;
			}
			self.frames = parseInt(msg, 10);
			self.received = 0;
			self.buf='';
		} else {

			if (self.state == IGNORED_STREAM) {
				++self.received;
				if (self.received == self.frames) {
					self.state = NORMAL;
					self.emit('ready');
				} else {
					self.emit('initProgress', self.received, self.frames);
				}
			} else if (self.state == STREAMING) {
				++self.received;
				self.buf += msg;
				if (self.received == self.frames) {
					self.state = NORMAL;
					handleMessage(self.buf);
					self.buf = null;
				}
			} else {
				handleMessage(msg);
			}
			
		}
	});

	function handleMessage(msg) {

		msg = JSON.parse(msg);

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
								self.state = IGNORE_NEXT_STREAM;
								self._rootRequested = Date.now();
								self._send({
									t: 'd',
									d: {
										r: ++self.req,
										a: 'q',
										b: {
											p: '/',
											h: ''
										}
									}
								}, function(msg) {
									if (msg.d.b.s != 'ok') {
										var err = new Error('Listen to root failed');
										err.msg = msg;
										self.emit('error', err);
									}
								});
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
				} else if (msg.d.a == 'd') {
					if (self.state == IGNORE_NEXT_STREAM) {
						self.state = NORMAL;
					} else {
						handleUpdate(self, msg.d.b.p, msg.d.b.d);
					}
				}
				break;
		}

	}
};

FirebaseWatcher.prototype.close = function() {
	clearInterval(this._keepalive);
	this.ws.close();
};

FirebaseWatcher.prototype._send = function(msg, cb) {
	if (cb) {
		this.reply[msg.d.r] = cb;
	}
	msg = JSON.stringify(msg);
	this.ws.send(msg);
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
};

FirebaseWatcher.prototype.unwatchAll = function() {
	this.watches = {};
	this.watchCount = 0;
};


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
