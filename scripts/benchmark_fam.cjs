/* Compare synchronous input-handler work on the SAME deterministic dataset.
   Usage: node scripts/benchmark_fam.cjs .cache/FAM-ui15-before-performance.html
   Results exclude startup/network/paint and are NOT a whole-app speed claim.
   No production data, credentials or files are uploaded. */
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {chromium}=require('playwright'),binary=require('@sparticuz/chromium');
const root=path.resolve(__dirname,'..');
const baseline=process.argv[2];
if(!baseline){console.error('Pass the path to the baseline standalone HTML.');process.exit(1);}
const files={baseline:fs.readFileSync(path.resolve(baseline)),current:fs.readFileSync(path.join(root,'FAM.html'))};
(async()=>{
  let browser,server;
  try{
    const dir=path.join(root,'.cache/chromium-libs');fs.mkdirSync(dir,{recursive:true});
    if(!process.env.CHROMIUM_PATH){
      const pkg=path.resolve(path.dirname(require.resolve('@sparticuz/chromium')),'../..');
      execFileSync('tar',['xf','-','-C',dir],{input:zlib.brotliDecompressSync(fs.readFileSync(path.join(pkg,'bin/al2023.tar.br')))});
      process.env.LD_LIBRARY_PATH=[path.join(dir,'lib'),process.env.LD_LIBRARY_PATH].filter(Boolean).join(':');
    }
    server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(files[req.url.startsWith('/baseline')?'baseline':'current']);});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||await binary.executablePath(),args:binary.args.filter(a=>a!=='--disable-web-security'),headless:true});
    const report={browser:browser.version(),rows:5000,columns:12,cpuThrottle:1,measurement:'synchronous input event handlers only; includes storage and quick-form synchronization',results:[]};
    const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
    const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for(const variant of ['baseline','current']){
      if(variant==='current')await page.evaluate(async()=>{await flushDeepSave();await idbDelete();localStorage.clear();sessionStorage.clear();});
      await page.goto(`http://127.0.0.1:${server.address().port}/${variant}`);
      await page.locator('#auth-username').fill('admin');await page.locator('#auth-password').fill('1109');await page.locator('#auth-submit').click();
      await page.waitForFunction(()=>document.querySelector('#cp-c9 option')&&Access.current());
      await page.evaluate(({rows,columns})=>{
        const data=[Array.from({length:columns},(_,c)=>c===0?'ID':'Field '+c)];
        for(let r=0;r<rows;r++)data.push(Array.from({length:columns},(_,c)=>c===0?'R'+r:c===1?'شعبه '+r:c===2?'10.'+(r%250)+'.'+Math.floor(r/250)+'.1':'value-'+r+'-'+c));
        const imported=importValidatedSheets(['Performance'],{Performance:{rows:data,merges:[]}},'synthetic.xlsx',true);
        if(!imported)throw Error('Fixture import failed');
      },report);
      await page.evaluate(()=>flushDeepSave());
      const results=await page.evaluate(async()=>{
        const original=packLZ;let count=0;
        packLZ=function(...args){count++;return original(...args);};
        const before=JSON.stringify(WB.sheets.Performance),out=[];
        try{
          for(const id of ['cp-c11','quick-cp-c11','cp-c27','quick-cp-c27']){
            const input=document.getElementById(id);if(!input)throw Error('Missing '+id);
            input.value='warm';input.dispatchEvent(new Event('input',{bubbles:true}));
            count=0;const times=[];
            for(let i=1;i<=20;i++){
              await new Promise(requestAnimationFrame);
              input.value='network-'.repeat(3).slice(0,i);
              const t=performance.now();input.dispatchEvent(new Event('input',{bubbles:true}));times.push(performance.now()-t);
            }
            const sorted=[...times].sort((a,b)=>a-b);
            out.push({input:id,events:times.length,fullCompressionCalls:count,medianMs:sorted[Math.floor(sorted.length/2)],p95Ms:sorted[Math.ceil(sorted.length*.95)-1],totalMs:times.reduce((a,b)=>a+b,0)});
          }
        }finally{packLZ=original;}
        if(JSON.stringify(WB.sheets.Performance)!==before)throw Error('Input modified workbook data');
        return {fixtureBytes:new TextEncoder().encode(before).length,inputs:out};
      });
      assert.deepEqual(errors,[]);
      for(const input of results.inputs)assert.equal(input.fullCompressionCalls,variant==='baseline'?input.events:0);
      report.results.push({variant,...results});
    }
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    fs.writeFileSync(path.join(root,'test-results/performance-ui16.json'),JSON.stringify(report,null,2)+'\n');
    console.log(JSON.stringify(report,null,2));
  }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
