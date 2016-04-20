var WebSocket = require('ws'),
	ws;


var reply = {};

var state = 0,
	req = 0,
	NORMAL = 0,
	IGNORE_NEXT_STREAM = 1,
	IGNORED_STREAM = 2,
	STREAMING = 3,
	frames,
	received,
	buf;




function connect(db, auth, host) {
	if (!host) host = db + '.firebaseio.com';

	console.log('CONNECT', host);
	ws = new WebSocket('wss://' + host + '/.ws?v=5&ns=' + db);
	ws.on('message', function(msg) {

		if (!isNaN(msg)) {
			if (state == IGNORE_NEXT_STREAM) {
				state = IGNORED_STREAM;
			} else {
				state = STREAMING;
			}
			frames = parseInt(msg, 10);
			received = 0;
			buf='';
		} else {

			if (state == IGNORED_STREAM) {
				++received;
				console.log(received + ' / ' + frames);
				if (received == frames) {
					state = NORMAL;
				}
			} else if (state == STREAMING) {
				++received;
				buf += msg;
				if (received == frames) {
					state = NORMAL;
					handleMessage(buf);
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
						close();
						connect(db, auth, msg.d.d);
						break;
					case 'h': // should be first message recieved
						send({
							t: 'd',
							d: {
								r: ++req, // 1
								a: 's',
								b: {
									c: {
										'firewatch-1-0-0': 1
									}
								}
							}
						}, function(msg) {
							if (msg.d.b.s == 'ok') {
								send({
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
						send({
							t: 'd',
							d: {
								r: ++req,
								a: 'auth',
								b: {
									cred: auth
								}
							}
						}, function(msg) {
							if (msg.d.b.s == 'ok') {
								ws.__keepalive = setInterval(sendKeepalive, 45000);
								state = IGNORE_NEXT_STREAM;
								send({
									t: 'd',
									d: {
										r: ++req,
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
					handleReply(msg);
				} else if (msg.d.a == 'd') {
					console.log('update to', msg.d.b.p, '=', msg.d.b.d);
				}
				break;
		}

	}
}

function sendKeepalive() {
	ws.send('0');
}

function close() {
	clearInterval(ws.__keepalive);
	ws.close();
}

function send(msg, cb) {
	if (cb) {
		reply[msg.d.r] = cb;
	}
	console.log('>', msg);
	ws.send(JSON.stringify(msg));
}

function handleReply(msg) {
	reply[msg.d.r](msg);
	delete reply[msg.d.r];
}

connect(process.argv[2], process.argv[3]);
