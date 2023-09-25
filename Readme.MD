# Websocket 

## with Promise
```javascript
// init 
const ws = new Websocket('ws://localhost:8080');
// send
const res = await ws.send({
	data: 'hello'
});
console.log(res);


```

## send 

## batchSend