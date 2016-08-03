firewatch
=========

Firewatch watches Firebase for change events.  It does not keep data synchronized like the official Firebase client, so memory usage is very low.

Why?
----

Say you have a key with millions of children, and you want to know when aan arbitrary change is made to a child.  With the official client, you'd have to keep the entire key in-memory -- which may not even be possible due to its large size.

    root = new Firebase(...);
    root.child('hugeList').on('value', ...);

With Firewatch, you can watch for changes without all the overhead.

    watcher = new FirebaseWatcher({
        db: 'example',
        auth: '<secret token>'
    });

    watcher.watch('hugeList', function(newValue) {
        // newValue = { 'child-key': ... }
    });

    watcher.connect();

New in v2
---------

Firewatch v1 was lazy and simply requested a watcher on the entire Firebase (the root -- `/`) and then filtered events to `watch` callbacks.  This worked, but was wasteful since you may end up transferring large amounts of data that you're not interested in.  It also incurred a massive penalty on the server (see below), and recent Firebase server changes actually broke this approach.

v2 fixes this by only registering Firebase listeners for the paths you pass in to `watch`, which is a win for everyone.

The only API change between 1.x and 2.x was the removal of two events: `initProgress` and `serverReady`.

Full details in [#2](https://github.com/casetext/firewatch/pull/2).

Startup penalty
---------------

Unfortunately, the Firebase service *insists* on first sending the entire current value of your data when you ask to listen for changes.   This means that when Firewatch first connects to Firebase, it must download a copy of all data under keys passed to `watch` (and throw this data out).

During this process, your Firebase instance will become unresponsive to all clients while the Firebase server copies your data into a server-side buffer.  All other clients' operations will queue.  **Expect 1 minute per GB of data.**  Once the copy is completed, normal operations resume while the data is transferred over the wire (so network speed does not affect downtime length).

See Also
--------

[firesentry](https://github.com/casetext/firesentry) is a utility that uses this library.  It provides a HTTP API that `git pull`s a repo and then does hot code reloading of firebase watchers.  This allows you to update your code without incurring the startup penalty.