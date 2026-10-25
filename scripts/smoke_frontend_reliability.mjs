import assert from 'node:assert/strict'

const origin = process.argv[2] || 'http://127.0.0.1:5176'
const debug = process.argv[3] || 'http://127.0.0.1:9224'
for (const address of [origin, debug]) {
  const url = new URL(address)
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Smoke checks require local HTTP servers')
  }
}
const page = await (await fetch(debug + '/json/new?about:blank', { method: 'PUT' })).json()
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject })
let id = 0
const pending = new Map()
const handlers = new Map()
const failures = []

ws.onmessage = ({ data }) => {
  const message = JSON.parse(data)
  if (!message.id) return handlers.get(message.method)?.(message.params)
  const request = pending.get(message.id)
  if (!request) return
  pending.delete(message.id)
  clearTimeout(request.timer)
  if (message.error) request.reject(new Error(JSON.stringify(message.error)))
  else request.resolve(message.result)
}

function cdp(method, params = {}) {
  return new Promise((resolve, reject) => {
    const number = ++id
    const timer = setTimeout(() => {
      pending.delete(number)
      reject(new Error('Browser command timed out: ' + method))
    }, 15000)
    pending.set(number, { resolve, reject, timer })
    ws.send(JSON.stringify({ id: number, method, params }))
  })
}

async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
  return result.result.value
}

async function wait(expression) {
  const deadline = Date.now() + 12000
  while (!await evaluate(expression)) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + expression + '; ' + await evaluate('document.body.innerText'))
    await new Promise(resolve => setTimeout(resolve, 30))
  }
}

async function click(text) {
  await evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})
    if (!button) throw new Error('Missing button: ' + ${JSON.stringify(text)})
    button.click()
  })()`)
}

async function photo() {
  await wait(`!!document.querySelector('input[type=file]')`)
  await evaluate(`(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    for (let y = 0; y < 256; y += 4) {
      for (let x = 0; x < 256; x += 4) {
        context.fillStyle = (x + y) % 8 ? 'white' : 'black'
        context.fillRect(x, y, 4, 4)
      }
    }
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg'))
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'generated.jpg', { type: 'image/jpeg' }))
    const input = document.querySelector('input[type=file]')
    input.files = transfer.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
  })()`)
}

// Run with Node 22, a local Vite server with VITE_LOCAL_METRICS=1 and
// VITE_API_URL=http://127.0.0.1:9877, and local headless Chrome's debugging URL.
// All API calls are synthetic, including errors. Never touches a live index.
let next = 'reject'
const apiCalls = []
async function fulfill(event, status, body) {
 await cdp('Fetch.fulfillRequest', {requestId:event.requestId,responseCode:status,
  responseHeaders:[{name:'Content-Type',value:'application/json'},
   {name:'Access-Control-Allow-Origin',value:origin},
   {name:'Access-Control-Allow-Headers',value:'Content-Type'},
   {name:'Access-Control-Allow-Methods',value:'GET,POST,OPTIONS'}],
  body:Buffer.from(JSON.stringify(body)).toString('base64')})
}
handlers.set('Fetch.requestPaused', event => {
 (async () => {
  const url = new URL(event.request.url)
  if (event.request.method === 'OPTIONS') return fulfill(event,200,{})
  apiCalls.push(url.pathname)
  if (url.pathname.endsWith('/health')) return fulfill(event,200,{ok:true,index_size:10,model:'synthetic-browser-check'})
  if (url.pathname.endsWith('/locate')) {
   if (next === 'reject') return fulfill(event,422,{detail:{code:'unrecognized_location'}})
   const tier=next
   next='picker'
   return fulfill(event,200,{photo_id:'p_'+'a'.repeat(32),spot:'F1_room164',floor:1,heading:null,
    confidence:.5,top3:[{spot:'F1_room164',votes:5}],ocr_room:null,ocr_floor:null,ms:1,
    p_correct:tier==='second'?.3:null,tier})
  }
  if (url.pathname.endsWith('/route')) return fulfill(event,200,{steps:[{instruction:'Walk toward Room 164',meters:2,node:'F1_room164'}],total_meters:2,est_seconds:2})
  await cdp('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'})
  throw new Error('Unexpected API request: '+url.pathname)
 })().catch(error=>failures.push(error.message))
})
handlers.set('Runtime.exceptionThrown', event=>failures.push(event.exceptionDetails.text))
await cdp('Runtime.enable')
await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true})
await cdp('Fetch.enable',{patterns:['*/health*','*/locate','*/route?*','*/correct'].map(urlPattern=>({urlPattern}))})
async function matchedRoom() {
 await wait(`document.body.innerText.includes('Which spot is this?')`)
 await evaluate(`[...document.querySelectorAll('main li button')].find(b=>b.textContent.includes('Room 164')).click()`)
}
try {
 await cdp('Page.navigate',{url:origin})
 await wait(`typeof window.houndMetrics === 'function' && !!document.querySelector('input[type=file]')`)
 await photo()
 await wait(`document.body.innerText.includes('We don’t recognize this spot')`)
 await click('Take another photo')
 next='picker'
 await wait(`!!document.querySelector('input[type=file]')`)
 await photo()
 await matchedRoom()
 await wait(`window.houndMetrics().routesReady === 1`)
 assert.equal(await evaluate(`window.houndMetrics().afterRejection`),1)
 assert.equal(await evaluate(`window.houndMetrics().withoutRetake`),0)
 await click('Lost? Take a new photo')
 next='reject'
 await photo()
 await wait(`document.body.innerText.includes('We don’t recognize this spot')`)
 await click('Type the room you’re next to')
 await wait(`!!document.querySelector('#manual-start')`)
 await evaluate(`(()=>{const input=document.querySelector('#manual-start');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'164');input.dispatchEvent(new Event('input',{bubbles:true}))})()`)
 await click('Get directions')
 await wait(`window.houndMetrics().routesReady === 2`)
 assert.equal(await evaluate(`window.houndMetrics().viaManualFallback`),1)
 await click('Lost? Take a new photo')
 next='second'
 await photo()
 await wait(`document.body.innerText.includes('Take the second photo')`)
 await photo()
 await matchedRoom()
 await wait(`window.houndMetrics().routesReady === 3`)
 const summary=await evaluate(`window.houndMetrics()`)
 assert.equal(summary.photoJourneysStarted,3)
 assert.equal(summary.afterRejection,2)
 assert.equal(summary.withoutRetake,2)
 assert.equal(summary.retakes,1)
 assert.equal(summary.photoToRoute.reduce((a,b)=>a+b,0),3)
 assert.equal(apiCalls.filter(path=>path.endsWith('/locate')).length,5)
 assert.equal(apiCalls.filter(path=>path.endsWith('/correct')).length,0)
 assert.deepEqual(failures,[])
 console.log('PASS: mobile rejection/retake, manual recovery, second-photo picker, and bounded local metrics; synthetic APIs only')
} finally { await cdp('Page.close').catch(()=>{}); ws.close() }
