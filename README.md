firewatch
=========

Firewatch watches an entire Firebase for change events.  It does not keep data synchronized like the official Firebase client, so memory usage is very low.

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

Startup penalty
---------------

Unfortunately, the Firebase service *insists* on first sending the entire current value of your data when you ask to listen for changes.   This means that when Firewatch first connects to Firebase, it must download a copy of your entire database (and throw this data out).

During this process, your Firebase instance will become unresponsive to all clients while the Firebase server copies your data into a server-side buffer.  All other clients' operations will queue.  **Expect 1 minute per GB of data.**  Once the copy is completed, normal operations resume while the data is transferred over the wire (so network speed does not affect downtime length).