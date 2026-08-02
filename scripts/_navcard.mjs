import { connect } from "./cdp.mjs";
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const app = await connect();
await app.ev(`location.href=${JSON.stringify(process.argv[2])};`); await sleep(1500); app.close();
