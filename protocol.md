First connect
=============

    wss://db.firebaseio.com/.ws?v=5

R: `{"t":"c","d":{"t":"r","d":"s-usc1c-nss-114.firebaseio.com"}}`

Server connect
==============

    wss://<ns server>/.ws?v=5&ns=db


R: `{"t":"c","d":{"t":"h","d":{"ts":1461173397480,"v":"5","h":"s-usc1c-nss-114.firebaseio.com","s":"6hcoCYSI0AfBv1FMVTT1mByUxiVAcGck"}}}`

S: `{"t":"d","d":{"r":1,"a":"s","b":{"c":{"sdk.js.2-4-2":1}}}}`

R: `{"t":"d","d":{"r":1,"b":{"s":"ok","d":""}}}`

S: `{"t":"c","d":{"t":"p","d":{}}}`

R: `{"t":"c","d":{"t":"o","d":null}}`

Auth
====

S: `{"t":"d","d":{"r":2,"a":"auth","b":{"cred":"<token>"}}}`

R: `{"t":"d","d":{"r":2,"b":{"s":"ok","d":{"auth":null,"expires":null}}}}`


Listen
======

S: `{"t":"d","d":{"r":3,"a":"q","b":{"p":"/","h":""}}}`

R: `{"t":"d","d":{"b":{"p":"","d":{"list":{"-JvusyBQvKx05NNj0pyk":{"foo":"bar"}},"test":{".value":true,".priority":1.0}}},"a":"d"}}`

R: `{"t":"d","d":{"r":3,"b":{"s":"ok","d":{}}}}`

Data
====

R: `{"t":"d","d":{"b":{"p":"list/-JvusyBQvKx05NNj0pyk/baz","d":1},"a":"d"}}`

