
/**
 *
demo below

var wsm = new WebSocket("ws://192.168.23.199:8054");

const aa = wsm.send(
    {
        "packetId": 0,
        "list":
            [
                {
                    "cmdType": "initOpen",
                    "baseUrl": "http://192.168.2.59:8765",
                    "openType": "modProjProxy",
                    "openId": "7bc182d84f9043bebb9bcd4a499add38",
                    "appId": "7bf7b151697c4adba41707f808daa7c2",
                    "secret": "ed349b4563f7dbffb881b24ebf07e6ee"
                }
            ]
    }
);

aa.then(data=>{
	console.log(data);
})

*/

interface OperationJSONObj{
    [key: string]: unknown;
}

function createGuid()	{
		function S4() {
				// eslint-disable-next-line no-bitwise
				return (((1 + Math.random()) * 0x10000) | 0).toString(16).substring(1);
		}
		// eslint-disable-next-line no-bitwise
		return (S4() + S4() + S4() + S4() + S4() + S4() + S4() + S4());
}

export enum RESPONSE_STATUS {
    ALL_SUCC = "ALL_SUCC",
    NOT_ALL_SUCC = "NOT_ALL_SUCC",
    ALL_FAILED = "ALL_FAILED",
}
export interface WSResponse {
    packetId: number;
    list: {
        code: number;
        data: unknown;
        msg: string;
    }[];
    status: RESPONSE_STATUS;
}

interface WebSocketInitOptions{
    errCallback: (err: string) => void;
    successCallback: (data: unknown) => void;
}

class WebSocketService {
    ws?: WebSocket;

    websocketUrl: string;

    packetId: number;

    isInit: boolean;

    wsErr: undefined | {info: string};

    reqPool: Map<number, {
        promsise: Promise<WSResponse>;
        resolve: (data: WSResponse) => void;
        reject: (reason: WSResponse) => void;
    }>;

    idMap: Map<string, string>;

    // TODO: 需要实现一个延时批量发送的机制 reqDataList.length>=300  send data to serverSide
    reqDataListWaitToSend: OperationJSONObj[];

    batchMaxReqList: number;

    batchSendInterval: number; // seconds

    batchTimer: null | number;

    openId: string;

    // common req data every request or common data
    reqData: {
        [key: string]: any;
    };

    constructor() {
        this.reqData = {}; // data need send in every request
        this.packetId = -1;
        this.reqPool = new Map();
        this.idMap = new Map();
        this.isInit = false;
        this.websocketUrl = "";
        this.openId = "";
        this.reqDataListWaitToSend = [];
        this.batchMaxReqList = 30;
        this.batchSendInterval = 3; // seconds
        this.batchTimer = null;
    }

    updateReqData(data: {
        [key: string]: any;
    }) {
        this.reqData = {...this.reqData, ...data};
    }

    updateIdMap(id1: string, id2: string) {
        this.idMap.set(id1, id2);
    }

    init(websocketUrl: string, opt?: WebSocketInitOptions) {
        this.websocketUrl = websocketUrl;
        const wsm = new WebSocket(websocketUrl);
        this.ws = wsm;
        this.isInit = true;
        let errCallback = (_err: string) => {
            //
        };
        if (opt !== undefined) {
            if (opt.errCallback) {
                errCallback = opt.errCallback;
            }
        }
        this.ws.onopen = () => {
            console.log("Connection open ...");
            if (opt !== undefined) {
                const {successCallback} = opt;
                successCallback("open");
            }
        };
        console.log(" ===== ws ", this.ws);
        this.ws.onmessage = (evt: MessageEvent) => {
            const res = JSON.parse(evt.data) as WSResponse;
            if (typeof res.packetId === "number") {
                const promiseObj = this.reqPool.get(res.packetId);
                const resList = res.list;
                const ALL_SUCC = resList.every((elem) => elem.code === 200);
                const ALL_FAILED = resList.every((elem) => elem.code !== 200);
                const NOT_ALL_SUCC = resList.some((elem) => elem.code !== 200);
                if (ALL_SUCC) {
                    res.status = RESPONSE_STATUS.ALL_SUCC;
                }
                if (ALL_FAILED) {
                    res.status = RESPONSE_STATUS.ALL_FAILED;
                }
                if (NOT_ALL_SUCC) {
                    res.status = RESPONSE_STATUS.NOT_ALL_SUCC;
                }

                console.log("Received Message: ", res);
                // if (res.status !== RESPONSE_STATUS.ALL_SUCC) {
                //     console.log("Received Message: res", res);
                // }
                if (promiseObj !== undefined) {
                    if (res.status !== RESPONSE_STATUS.ALL_FAILED) {
                        promiseObj.resolve(res);
                        this.reqPool.delete(res.packetId);
                    } else {
                        promiseObj.reject(res);
                        this.reqPool.delete(res.packetId);
                    }
                }
            }
        };
        this.ws.onclose = (evt: CloseEvent) => {
            // TODO: handle close
            console.log("Connection closed.", evt);
            const {reason} = evt;
            errCallback(reason);
            this.wsErr = {
                info: reason
            };
        };
        this.ws.onerror = (e: Event) => {
            console.error("Websocket Err ", e);
            // errCallback(e);
            this.wsErr = {
                info: "Websocket connect Error"
            };
        };
    }

    initOpen() {
        console.log(" init open ");
    }

    destroy() {
        if (this.ws !== undefined) {
            this.ws.close();
        }
        this.reqPool.clear();
    }

    getGuid() {
        return createGuid();
    }

    updatePacketId() {
        this.packetId += 1;
    }

    update(data: OperationJSONObj[]) {
        this.reqDataListWaitToSend = [...this.reqDataListWaitToSend, ...data];
    }

    async batchSend(data: OperationJSONObj[]): Promise<WSResponse | undefined> {
        // NOTE: 对实时性要求高的 不要使用这个接口 这个是延时批量发送数据接口
        this.update(data);
        // 2个条件
        // 1. 达到预定最大消息长度
        // 2. 达到最大发送间隔

        // 条件1
        if (this.reqDataListWaitToSend.length >= this.batchMaxReqList) {
            const list = [...this.reqDataListWaitToSend];
            this.reqDataListWaitToSend = [];
            if (list.length > 0) {
                if (this.batchTimer !== null) {
                    clearTimeout(this.batchTimer);
                    this.batchTimer = null;
                }
                return this.send(list);
            }
        }
        // 条件2
        // 该接口被调用 会等待1s在发送 期间如果有新的调用 会把reqdata统一一起发送
        if (this.batchTimer === null) {
            let resolveFn: (value?: unknown) => void;
            let rejectFn: (reason?: unknown) => void;
            const promise = new Promise((resolve, reject) => {
                resolveFn = resolve;
                rejectFn = reject;
            });
            this.batchTimer = setTimeout(() => {
                const list = [...this.reqDataListWaitToSend];
                this.reqDataListWaitToSend = [];
                this.send(list).then((res) => resolveFn(res), (err) => rejectFn(err));
                if (this.batchTimer !== null) {
                    clearTimeout(this.batchTimer);
                    this.batchTimer = null;
                }
            }, this.batchSendInterval * 1000);

            // @ts-ignore
            return promise;
        }
        return undefined;
    }

    async send(data: OperationJSONObj[], extraKeyValuePara = {}): Promise<WSResponse> {
        if (!this.websocketUrl) {
            return Promise.reject(new Error("Websocket Url is not defined"));
        }
        if (!this.isInit) {
            return Promise.reject(new Error("WebSocket not inited"));
        }
        if (this.wsErr) {
            return Promise.reject(new Error("WebSocket connected failed"));
        }
        if (this.ws?.readyState !== 1) {
            return Promise.reject(new Error("WebSocket not ready "));
        }
        const recordPromsie = {
            promise: new Promise(() => {
                //
            }),
            resolve: (_value: unknown) => {
                //
            },
            reject: () => {
                //
            }
        };
        const promise = new Promise((resolve, reject) => {
            recordPromsie.resolve = resolve;
            recordPromsie.reject = reject;
        });
        recordPromsie.promise = promise;

        // const guid = this.getGuid();
        this.updatePacketId();
        const guid = this.packetId;

        if (typeof data === "object") {
            const sendData: {[key: string]: unknown} = {
                list: [...data],
                ...this.reqData,
                ...extraKeyValuePara,
            };
            sendData.packetId = guid;
            if (this.openId) {
                sendData.openId = this.openId;
            }
            console.log("=== ws sendData is:  ", sendData);
            if (this.ws !== undefined) {
                this.ws.send(JSON.stringify(sendData));
            }
        } else {
            throw new Error("data must be object type !");
        }
        // @ts-ignore
        this.reqPool.set(guid, recordPromsie);

        // @ts-ignore
        return promise;
    }
}

const websocketService = new WebSocketService();
export {websocketService};

export default WebSocketService;
