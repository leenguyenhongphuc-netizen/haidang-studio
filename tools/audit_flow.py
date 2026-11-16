# Rà toàn luồng Hải Đăng Studio trên 6 thiết bị. Ghi dữ liệu (hd_put/hd_del) được chặn, không ghi vào dữ liệu thật.
import asyncio, sys, json
from playwright.async_api import async_playwright
BASE=sys.argv[1]; OUT=sys.argv[2]; import os; PW=os.environ['HD_PASS']
ONLY=sys.argv[3].split(',') if len(sys.argv)>3 else None
DEV=[('p412',412,915,'chromium',True,'light'),('i390',390,844,'webkit',True,'light'),('t820',820,1180,'webkit',True,'light'),('t1180',1180,820,'webkit',False,'light'),('d1366',1366,768,'chromium',False,'light'),('d1920',1920,1080,'chromium',False,'light'),('p430dark',430,932,'chromium',True,'dark')]
CHK="""()=>{const W=innerWidth;const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>0&&r.height>0&&s.visibility!=='hidden'&&s.display!=='none'};
const tap=[...document.querySelectorAll('button,a.btn,.fxl a,.jump a,.ep-tabs a,.tabbar a,.nav a,select,input:not([type=checkbox]),summary')].filter(vis).filter(e=>e.getBoundingClientRect().height<40).map(e=>(e.textContent||e.id||e.className).trim().slice(0,24));
const tiny=[...document.querySelectorAll('body *')].filter(e=>e.childElementCount===0&&e.textContent.trim()&&vis(e)&&parseFloat(getComputedStyle(e).fontSize)<12.5).map(e=>e.textContent.trim().slice(0,20));
const rows=sel=>new Set([...document.querySelectorAll(sel)].filter(vis).map(e=>Math.round(e.getBoundingClientRect().top))).size;
const hidden=[...document.querySelectorAll('main button, main a.btn')].filter(vis).filter(e=>{const r=e.getBoundingClientRect();const tb=document.querySelector('.tabbar');if(!tb||!vis(tb))return false;return false}).length;
return {ovf:document.documentElement.scrollWidth>W+1,tap:tap.slice(0,6),ntap:tap.length,tiny:[...new Set(tiny)].slice(0,6),tab:rows('.tabbar a'),sub:rows('.subnav button')}}"""
async def shot(pg,tag,name,full=True):
    for y in range(0,25000,800):
        await pg.evaluate(f"scrollTo(0,{y})"); await pg.wait_for_timeout(25)
    await pg.evaluate("scrollTo(0,0)"); await pg.wait_for_timeout(350)
    m=await pg.evaluate(CHK); await pg.screenshot(path=f"{OUT}/{tag}_{name}.png",full_page=full); return m
async def main():
  async with async_playwright() as p:
    for tag,w,h,eng,mob,cs in DEV:
      if ONLY and tag not in ONLY: continue
      b=await (p.webkit if eng=='webkit' else p.chromium).launch(**({} if eng=='webkit' else {'executable_path':'/usr/bin/google-chrome'}))
      ctx=await b.new_context(viewport={'width':w,'height':h},is_mobile=mob and eng=='chromium',has_touch=mob,color_scheme=cs)
      writes=[]
      async def stub(route): writes.append(route.request.url.split('/')[-1]); await route.fulfill(status=204,body='')
      await ctx.route('**/rpc/hd_put',stub); await ctx.route('**/rpc/hd_del',stub)
      pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e:errs.append(str(e)[:140]))
      R={}
      # cổng: sai mật khẩu rồi đúng
      await pg.goto(BASE); await pg.wait_for_timeout(800)
      await pg.fill('#gatePass','sai'); await pg.click('#gateBtn'); await pg.wait_for_timeout(2500)
      R['gate_wrong']=await pg.text_content('#gateMsg'); await pg.screenshot(path=f"{OUT}/{tag}_00gate.png")
      await pg.fill('#gatePass',PW); await pg.click('#gateBtn'); await pg.wait_for_selector('#gate.hide',state='attached',timeout=30000); await pg.wait_for_timeout(1800)
      R['today']=await shot(pg,tag,'01today')
      await pg.evaluate("location.hash='#/hanh-trinh'"); await pg.wait_for_timeout(900); R['trip']=await shot(pg,tag,'02trip')
      await pg.click('[data-day="3"]'); await pg.wait_for_timeout(700); await pg.screenshot(path=f"{OUT}/{tag}_03daysheet.png"); await pg.click('#closeSheet')
      await pg.evaluate("location.hash='#/chi-tieu'"); await pg.wait_for_timeout(900)
      await pg.click('#expForm button[type=submit]'); await pg.wait_for_timeout(300); R['money_empty_valid']=await pg.evaluate("document.querySelector('#expAmt').validity.valid")
      await pg.fill('#expAmt','150'); await pg.fill('#expNote','Khao soi thử'); await pg.click('#expForm button[type=submit]'); await pg.wait_for_timeout(800)
      R['money']=await shot(pg,tag,'04money')
      for t in ['quay','kichban','dung','dohoa']:
        await pg.evaluate("location.hash='#/san-xuat/1'"); await pg.wait_for_timeout(700)
        await pg.click(f'[data-tab={t}]'); await pg.wait_for_timeout(1600)
        if t=='quay':
          await pg.click('details.beat:nth-of-type(1) > summary .bt'); await pg.wait_for_timeout(300)
        R['prod_'+t]=await shot(pg,tag,'05prod_'+t)
      await pg.evaluate("location.hash='#/hieu-ung'"); await pg.wait_for_timeout(1200); R['fx']=await shot(pg,tag,'06fx')
      await pg.click('[data-big="d-3"]'); await pg.wait_for_timeout(1500); await pg.screenshot(path=f"{OUT}/{tag}_07fxbig.png"); await pg.click('#closeSheet')
      await pg.evaluate("location.hash='#/kenh'"); await pg.wait_for_timeout(1200); await pg.screenshot(path=f"{OUT}/{tag}_08kenh.png")
      # quay lại không giật
      await pg.evaluate("location.hash='#/hanh-trinh'"); await pg.wait_for_timeout(600); await pg.go_back(); await pg.wait_for_timeout(800); R['back_hash']=await pg.evaluate("location.hash")
      R['errs']=errs; R['writes_stubbed']=len(writes)
      print(tag,json.dumps(R,ensure_ascii=False),flush=True)
      await b.close()
asyncio.run(main())
