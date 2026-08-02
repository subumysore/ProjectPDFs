import { connect } from "./cdp.mjs";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const app = await connect();
await sleep(1100); await app.ev(`location.reload();`); await sleep(400); app.close();
