var WebSocket = require('ws');

var NORMAL = 0,
	IGNORE_NEXT_STREAM = 1,
	IGNORED_STREAM = 2,
	STREAMING = 3;


function FirebaseWatcher(opts) {
	this.db = opts.db;
	this.auth = opts.auth;
	this.host = opts.host;
	this.req = 0;
	this.reply = {};
}



FirebaseWatcher.prototype.connect = function() {
	var self = this;
	if (!self.host) self.host = self.db + '.firebaseio.com';

	console.log('CONNECT', self.host);
	self.ws = new WebSocket('wss://' + self.host + '/.ws?v=5&ns=' + self.db);
	self.ws.on('message', function(msg) {

		if (!isNaN(msg)) {
			if (self.state == IGNORE_NEXT_STREAM) {
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
				console.log(self.received + ' / ' + self.frames);
				if (self.received == self.frames) {
					self.state = NORMAL;
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

		console.log('<', msg);

		msg = JSON.parse(msg);

		switch (msg.t) {
			case 'c':
				switch (msg.d.t) {
					case 'r': // redirect to different server
						self.close();
						self.host = msg.d.d;
						self.connect();
						break;
					case 'h': // should be first message recieved
						self._send({
							t: 'd',
							d: {
								r: ++self.req, // 1
								a: 's',
								b: {
									c: {
										'firewatch-1-0-0': 1
									}
								}
							}
						}, function(msg) {
							if (msg.d.b.s == 'ok') {
								self._send({
									t: 'c',
									d: {
										t: 'p',
										d: {}
									}
								});
							} else {
								console.error(msg);
								throw new Error('Handshake failed');
							}
						});
						break;

					case 'o': // response to t:c msg sent after req 1
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
										console.error(msg);
										throw new Error('Listen to root failed');
									}
								});
							} else {
								console.error(msg);
								throw new Error('Auth failed');
							}
						});
						break;
				}
				break;
			case 'd':
				if (msg.d.r) {
					handleReply(self, msg);
				} else if (msg.d.a == 'd') {
					console.log('update to', msg.d.b.p, '=', msg.d.b.d);
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
	console.log('>', msg);
	this.ws.send(JSON.stringify(msg));
}


function sendKeepalive(self) {
	self.ws.send('0');
}


function handleReply(self, msg) {
	self.reply[msg.d.r](msg);
	delete self.reply[msg.d.r];
}



exports = module.exports = FirebaseWatcher;

var watcher = new FirebaseWatcher({
	db: process.argv[2],
	auth: process.argv[3]
});

watcher.connect();
