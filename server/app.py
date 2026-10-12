"""Central FAM service. Run behind HTTPS IIS; SQLite must be on a local disk.
All authorisation is server-side. Browser snapshots use optimistic revisions and
idempotent receipts; no last-writer-wins or automatic conflict overwrite.
"""
import copy
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from flask import Flask, request, jsonify, g, send_file

ROOT = Path(__file__).resolve().parent
SYSTEM = {'CONTROL_PANEL','SYSTEM_SEARCH_INDEX','SYSTEM_SHEET_CONFIG','SYSTEM_DATA_DICTIONARY','CHANGE_LOG','SEARCH_RESULTS','SYSTEM_KEYS','SYSTEM_UNDO_BUFFER','SYSTEM_NAVIGATOR'}
EPHEMERAL = SYSTEM - {'SYSTEM_SHEET_CONFIG', 'SYSTEM_KEYS'}
META = {'SYSTEM_SHEET_CONFIG', 'SYSTEM_KEYS'}
ARCHIVES = {'لیست جمع آوری سرویس','جمع آوری مبین نت','جمع آوری آسیاتک'}
FORBIDDEN = {'__proto__','constructor','prototype'}
REGIONS = [
 ['خراسان رضوی','خراسان شمالی','خراسان جنوبی','سیستان و بلوچستان','گلستان'],
 ['تهران'],
 ['اردبیل','آذربایجان غربی','آذربایجان شرقی','خوزستان','قم','کردستان','لرستان','همدان','مرکزی','کرمانشاه','قزوین','زنجان','البرز','کهگیلویه و بویراحمد'],
 ['فارس','ایلام','اصفهان','بوشهر','چهارمحال و بختیاری','سمنان','یزد','گیلان','مازندران','هرمزگان','کرمان']]
ALIASES={'آذربایجان غربی':['آذرغربی','آذربایجانغربی'],'آذربایجان شرقی':['آذرشرقی','آذربایجانشرقی'],'کهگیلویه و بویراحمد':['کهکلویه','کهکیلویه','کهگیلویه','کهکیلویه و بویر احمد']}
EMPTY={'v':2,'order':[],'sheets':{},'lockedSheets':{},'categoryConfig':None,'regionConfig':None,'panelProtected':True}

def packed(value):
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'), sort_keys=True, allow_nan=False)

def norm(s):
    return str(s).replace('ي','ی').replace('ى','ی').replace('ك','ک').strip().lower()

def province_key(s):
    s=re.sub(r'^(?:خودپرداز|شعبه|شعب)\s+', '', norm(s))
    s=re.sub(r'^استان\s*', '', s)
    return re.sub(r'[\s\u200c\u200d\u0640]', '', s)

def province(name):
    key=province_key(name)
    for r,names in enumerate(REGIONS,1):
        for i,n in enumerate(names,1):
            if key in [province_key(a) for a in [n]+ALIASES.get(n,[])]:return (f'{r}-{i}',str(r))
    return None

def can_read(user, name, state):
    if name not in state['sheets']:return False
    if user['role']<=2:return True
    if name in SYSTEM:return False
    if user['role']==3:return True
    if name not in user['sheets']:return False
    p=province(name)
    if not p:return True
    assignments=dict((state.get('regionConfig') or {}).get('assignments',[]))
    region=assignments.get(p[0],p[1] if not state.get('regionConfig') else 'unassigned')
    return region in user['regions']

class Problem(Exception):
    def __init__(self,status,message):self.status=status;self.message=message

def fail(status,message):raise Problem(status,message)

def safe_tree(obj,depth=0):
    if isinstance(obj,float) and not math.isfinite(obj):fail(400,'عدد نامعتبر است.')
    if depth>30:fail(400,'ساختار داده بیش از حد تو در تو است.')
    if isinstance(obj,dict):
        for k,v in obj.items():
            if k in FORBIDDEN:fail(400,'کلید نامعتبر در داده.')
            safe_tree(v,depth+1)
    elif isinstance(obj,list):
        for v in obj:safe_tree(v,depth+1)

def validate_state(raw):
    if not isinstance(raw,dict):fail(400,'داده معتبر نیست.')
    safe_tree(raw)
    order=raw.get('order');sheets=raw.get('sheets')
    if not isinstance(order,list) or not all(isinstance(n,str) for n in order) or not isinstance(sheets,dict) or len(order)>500:fail(400,'فهرست بخش‌ها معتبر نیست.')
    if len(order)!=len(set(order)) or set(order)!=set(sheets):fail(400,'نام بخش‌ها تکراری یا ناقص است.')
    names=set();clean={}
    for name in order:
        if not isinstance(name,str) or not name.strip() or len(name)>31 or re.search(r'[\x00-\x1f\\/*?:\[\]]',name) or norm(name) in names:fail(400,'نام بخش نامعتبر است.')
        names.add(norm(name));sh=sheets[name]
        if not isinstance(sh,dict) or not isinstance(sh.get('rows'),list) or not isinstance(sh.get('merges'),list):fail(400,'ساختار شیت نامعتبر است.')
        if len(sh['rows'])>250000 or len(sh['merges'])>20000:fail(413,'داده از سقف این نسخه بیشتر است.')
        for row in sh['rows']:
            if not isinstance(row,list) or len(row)>200:fail(400,'ستون‌های شیت نامعتبر است.')
            for cell in row:
                if cell is not None and type(cell) not in (str,int,float,bool):fail(400,'نوع سلول نامعتبر است.')
                if isinstance(cell,str) and len(cell)>100000:fail(413,'متن سلول بیش از حد بلند است.')
        for m in sh['merges']:
            if not isinstance(m,dict) or set(m)!={'r1','c1','r2','c2'} or any(type(v)!=int for v in m.values()) or not (1<=m['r1']<=m['r2']<=250000 and 1<=m['c1']<=m['c2']<=200):fail(400,'ادغام سلول نامعتبر است.')
        if name not in EPHEMERAL:clean[name]={'rows':sh['rows'],'merges':sh['merges']}
    locks=raw.get('lockedSheets') or {}
    if not isinstance(locks,dict) or any(type(v)!=bool for v in locks.values()):fail(400,'قفل شیت‌ها نامعتبر است.')
    for config in ['categoryConfig','regionConfig']:
        if raw.get(config) is not None and not isinstance(raw[config],dict):fail(400,'پیکربندی نامعتبر است.')
    region=raw.get('regionConfig')
    if region is not None:
        if region.get('version')!=1 or not isinstance(region.get('regions'),list) or not isinstance(region.get('assignments'),list):fail(400,'پیکربندی مناطق نامعتبر است.')
        ids=[]
        for r in region['regions']:
            if not isinstance(r,dict) or not isinstance(r.get('id'),str) or not isinstance(r.get('name'),str):fail(400,'منطقه نامعتبر است.')
            ids.append(r['id'])
        seen=set();valid={f'{r}-{i}' for r,ns in enumerate(REGIONS,1) for i,_ in enumerate(ns,1)}
        for pair in region['assignments']:
            if not isinstance(pair,list) or len(pair)!=2 or not all(isinstance(v,str) for v in pair) or pair[0] not in valid or pair[0] in seen or pair[1] not in ids+['unassigned']:fail(400,'انتساب استان نامعتبر است.')
            seen.add(pair[0])
        if seen!=valid or len(ids)!=len(set(ids)):fail(400,'همهٔ استان‌ها باید یک انتساب مشخص داشته باشند.')
    return {'v':2,'order':[n for n in order if n in clean],'sheets':clean,'lockedSheets':locks,'categoryConfig':raw.get('categoryConfig'),'regionConfig':region,'panelProtected':raw.get('panelProtected',True) is not False}

def sequence_delta(old,new):
    """Only insertion OR deletion, never replacement/reordering. Preserve exact types."""
    a=[packed(x) for x in old];b=[packed(x) for x in new]
    small,large=(a,b) if len(a)<=len(b) else (b,a)
    i=0
    for row in large:
        if i<len(small) and row==small[i]:i+=1
    return i==len(small)

def trim_rows(rows):
    end=len(rows)
    while end>1 and all(v is None or (isinstance(v,str) and not v.strip()) for v in rows[end-1]):end-=1
    return rows[:end]

def valid_merge_shift(before,after,archive=False):
    """Mirror FAM shiftMerges; no independent merge edits by level 3.
    Both greedy alignments permit identical repeated rows at either edge.
    Ambiguous interior duplicate/merged deletions fail closed for admin review.
    """
    a=[packed(r) for r in trim_rows(before['rows'])[1:]]
    b=[packed(r) for r in trim_rows(after['rows'])[1:]]
    if a==b:return before['merges']==after['merges']
    if archive and b[:len(a)]==a and before['merges']==after['merges']:return True
    inserting=len(a)<len(b);small,large=(a,b) if inserting else (b,a)
    for reverse in (False,True):
        si=list(range(len(small)));li=list(range(len(large)))
        if reverse:si.reverse();li.reverse()
        pos=0;edits=[]
        for i in li:
            if pos<len(si) and small[si[pos]]==large[i]:pos+=1
            else:edits.append(i+2)
        if pos!=len(small):continue
        merges=copy.deepcopy(before['merges'])
        for at in sorted(edits,reverse=not inserting):
            for m in merges:
                for edge in ('r1','r2'):
                    if inserting and m[edge]>=at:m[edge]+=1
                    elif not inserting and m[edge]>at:m[edge]-=1
        if merges==after['merges']:return True
    return False

def authorise_change(user,old,new):
    for n,locked in old['lockedSheets'].items():
        if locked and new['lockedSheets'].get(n) and packed(old['sheets'].get(n))!=packed(new['sheets'].get(n)):fail(403,'بخش قفل است؛ ابتدا قفل را باز کنید.')
    if user['role']<=2:return
    if user['role']!=3:fail(403,'این حساب فقط اجازهٔ مشاهده دارد.')
    for key in ('lockedSheets','categoryConfig','regionConfig','panelProtected'):
        if packed(old.get(key))!=packed(new.get(key)):fail(403,'تغییر تنظیمات برای سطح ۳ مجاز نیست.')
    old_names=[n for n in old['order'] if n not in SYSTEM]
    new_names=[n for n in new['order'] if n not in SYSTEM]
    if [n for n in new_names if n in old_names]!=old_names:fail(403,'حذف یا جابه‌جایی بخش مجاز نیست.')
    for name in new_names:
        after=new['sheets'][name];before=old['sheets'].get(name)
        if before is None:
            p=province(name)
            sources=[s for n,s in old['sheets'].items() if n not in SYSTEM and province(n)==p and not n.startswith('خودپرداز ')]
            template=next((s for s in sources if s['rows'] and packed(s['rows'][0])==packed((after['rows'] or [None])[0]) and [m for m in s['merges'] if m['r1']==m['r2']==1]==after['merges']),None)
            if not name.startswith('خودپرداز ') or not p or template is None or len(trim_rows(after['rows']))<2:fail(403,'ایجاد این بخش برای سطح ۳ مجاز نیست.')
            continue
        if packed(before)==packed(after):continue
        if old['lockedSheets'].get(name):fail(403,'بخش قفل است.')
        if not before['rows'] or not after['rows'] or packed(before['rows'][0])!=packed(after['rows'][0]):fail(403,'ویرایش عنوان ستون برای سطح ۳ مجاز نیست.')
        if not sequence_delta(trim_rows(before['rows'])[1:],trim_rows(after['rows'])[1:]):fail(403,'سطح ۳ فقط اجازهٔ درج یا حذف ردیف دارد؛ ویرایش مستقیم مجاز نیست.')
        if not valid_merge_shift(before,after,name in ARCHIVES):fail(403,'تغییر ساختار ادغام مجاز نیست.')
    # Mapping/key metadata is server-owned for level 3; local reindexing is derived.
    for n in META:
        if n in old['sheets']:new['sheets'][n]=old['sheets'][n]
        else:new['sheets'].pop(n,None)
    new['order']=[n for n in new['order'] if n in new['sheets']]
    for n in old['order']:
        if n in META and n not in new['order']:new['order'].append(n)

def public_user(row):
    return {k:row[k] for k in ['id','username','name','role','enabled','revision']} | {'enabled':bool(row['enabled']),'regions':json.loads(row['regions']),'sheets':json.loads(row['sheets'])}

def credentials(password,salt=None):
    if not isinstance(password,str) or not 4<=len(password)<=128:fail(400,'رمز باید بین ۴ تا ۱۲۸ نویسه باشد.')
    salt=salt or secrets.token_hex(16)
    return salt,hashlib.pbkdf2_hmac('sha256',password.encode(),bytes.fromhex(salt),210000).hex()

class ClosingConnection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()

def create_app(config=None):
    app=Flask(__name__,static_folder=None)
    app.json.ensure_ascii=False
    app.json.sort_keys=False
    app.config.update(DB_PATH=os.environ.get('FAM_DB',str(ROOT/'private'/'fam.sqlite3')),
      PUBLIC_ORIGIN=os.environ.get('FAM_PUBLIC_ORIGIN',''), COOKIE_SECURE=True,
      MAX_CONTENT_LENGTH=32*1024*1024, TESTING=False)
    if config:app.config.update(config)
    if not app.config['PUBLIC_ORIGIN']:raise RuntimeError('Set FAM_PUBLIC_ORIGIN to the HTTPS origin (no trailing slash).')
    if not app.config['TESTING'] and not app.config['PUBLIC_ORIGIN'].startswith('https://'):raise RuntimeError('Production requires HTTPS.')
    dbpath=Path(app.config['DB_PATH']).resolve()
    if dbpath.is_relative_to(ROOT/'www'):raise RuntimeError('The database must be outside the public www directory.')
    dbpath.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    try:
        fd=os.open(dbpath,os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600);os.close(fd)
    except FileExistsError:pass
    def connect():
        db=sqlite3.connect(dbpath,timeout=15,isolation_level=None,factory=ClosingConnection);db.row_factory=sqlite3.Row
        db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA busy_timeout=15000');db.execute('PRAGMA synchronous=FULL')
        return db
    @contextmanager
    def transaction():
        db=connect()
        try:
            db.execute('BEGIN IMMEDIATE');yield db;db.commit()
        except BaseException:db.rollback();raise
        finally:db.close()
    with connect() as db:
        existing={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        fresh=not existing
        required={'state','users','settings','sessions','receipts','audit','undo','attempts'}
        if existing and not required<=existing:raise RuntimeError('Existing database has an incomplete/unknown schema; restore a verified backup.')
        db.execute('PRAGMA journal_mode=WAL')
        db.executescript('''
        CREATE TABLE IF NOT EXISTS state(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, epoch TEXT NOT NULL, payload TEXT NOT NULL, saved_at INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role INTEGER NOT NULL, enabled INTEGER NOT NULL, regions TEXT NOT NULL, sheets TEXT NOT NULL, revision TEXT NOT NULL, salt TEXT NOT NULL, hash TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), users_revision INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, user_revision TEXT NOT NULL, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS receipts(user_id TEXT NOT NULL, request_id TEXT NOT NULL, digest TEXT NOT NULL, response TEXT NOT NULL, PRIMARY KEY(user_id,request_id));
        CREATE TABLE IF NOT EXISTS audit(revision INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, names TEXT NOT NULL, snapshot TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS undo(user_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT);
        CREATE TABLE IF NOT EXISTS attempts(bucket TEXT PRIMARY KEY, started INTEGER NOT NULL, failures INTEGER NOT NULL);
        ''')
    with transaction() as db:
        if not db.execute('SELECT 1 FROM state').fetchone():
            if not fresh:raise RuntimeError('Existing database has lost its state; refusing to reseed accounts.')
            salt,digest=credentials(os.environ.get('FAM_INITIAL_PASSWORD','1109'))
            db.execute('INSERT INTO state VALUES(1,0,?,?,0)',(str(uuid.uuid4()),packed(EMPTY)))
            db.execute('INSERT INTO settings VALUES(1,0)')
            db.execute('INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?)',(str(uuid.uuid4()),'admin','admin',1,1,'[]','[]',str(uuid.uuid4()),salt,digest))
        if not db.execute('SELECT 1 FROM settings WHERE id=1').fetchone():raise RuntimeError('Database settings missing; restore a verified backup.')
        validate_state(json.loads(db.execute('SELECT payload FROM state WHERE id=1').fetchone()[0]))
        if not db.execute('SELECT 1 FROM users WHERE role=1 AND enabled=1').fetchone():raise RuntimeError('No active administrator: restore a verified backup, do not reseed.')
    def user_and_session(db):
        token=hashlib.sha256(request.cookies.get('fam_session','').encode()).hexdigest()
        session=db.execute('SELECT * FROM sessions WHERE token=? AND expires>?',(token,int(time.time()))).fetchone()
        if not session:fail(401,'نشست معتبر نیست؛ دوباره وارد شوید.')
        user=db.execute('SELECT * FROM users WHERE id=? AND enabled=1',(session['user_id'],)).fetchone()
        if not user or user['revision']!=session['user_revision']:fail(401,'مجوز یا رمز حساب تغییر کرده است؛ دوباره وارد شوید.')
        return public_user(user),session
    @app.before_request
    def guard():
        if not request.path.startswith('/api/'):return
        if request.method not in ('GET','HEAD','OPTIONS'):
            if request.headers.get('Origin')!=app.config['PUBLIC_ORIGIN']:fail(403,'مبدأ درخواست مجاز نیست.')
            if not request.is_json:fail(415,'بدنهٔ JSON لازم است.')
        if request.path=='/api/login':return
        with connect() as db:g.user,g.session=user_and_session(db)
        if request.method not in ('GET','HEAD') and not hmac.compare_digest(request.headers.get('X-FAM-CSRF',''),g.session['csrf']):fail(403,'توکن درخواست معتبر نیست.')
    @app.after_request
    def headers(response):
        response.headers['Cache-Control']='no-store'
        response.headers['X-Content-Type-Options']='nosniff'
        response.headers['Referrer-Policy']='same-origin'
        return response
    @app.errorhandler(Problem)
    def problem(e):return jsonify(error=e.message),e.status
    @app.errorhandler(sqlite3.IntegrityError)
    def integrity(e):return jsonify(error='نام یا شناسهٔ تکراری؛ درخواست ثبت نشد.'),400
    @app.errorhandler(400)
    def malformed(e):return jsonify(error='بدنهٔ JSON نامعتبر است.'),400
    @app.errorhandler(413)
    def too_large(e):return jsonify(error='حجم درخواست بیش از ۳۲ مگابایت است.'),413
    def data():
        value=request.get_json()
        if not isinstance(value,dict):fail(400,'بدنهٔ JSON نامعتبر است.')
        safe_tree(value);return value
    def admin(user):
        if user['role']!=1:fail(403,'این عملیات فقط برای مدیر سطح ۱ است.')
    def undo_summary(db,revision):
        row=db.execute('SELECT at FROM audit WHERE revision=? AND snapshot!=?',(revision,'')).fetchone()
        return {'valid':True,'serverRevision':revision,'blockCount':1,'blocks':[],'ts':row['at']} if row else None
    @app.get('/api/undo-state')
    def undo_state():
        if g.user['role']>2:fail(403,'بازگشت فقط برای مدیر مجاز است.')
        with connect() as db:
            db.execute('BEGIN');u,_=user_and_session(db)
            if u['role']>2:fail(403,'مجوز تغییر کرده است.')
            current=db.execute('SELECT revision,epoch FROM state WHERE id=1').fetchone()
            old=db.execute('SELECT * FROM audit WHERE revision=?',(current['revision'],)).fetchone()
            if not old or not old['snapshot']:fail(404,'نسخه‌ای برای بازگشت موجود نیست.')
            return jsonify(state=json.loads(old['snapshot']),revision=current['revision'],epoch=current['epoch'],user=u,actor=old['actor'],sheets=old['names'])
    def envelope(db,user,session=None):
        row=db.execute('SELECT * FROM state WHERE id=1').fetchone();p=json.loads(row['payload'])
        allowed=[n for n in p['order'] if can_read(user,n,p) or (user['role']==3 and n in META)]
        p['order']=allowed;p['sheets']={n:p['sheets'][n] for n in allowed}
        if user['role']==4:p['categoryConfig']=None;p['lockedSheets']={n:True for n in allowed}
        p['undo']=undo_summary(db,row['revision']) if user['role']<=2 else None
        p['savedAt']=row['saved_at']
        if user['role']<=2:
            logs=db.execute('SELECT revision,at,actor,names FROM audit ORDER BY revision DESC LIMIT 200').fetchall()
            p['sheets']['CHANGE_LOG']={'rows':[['Time','Action','Sheets','Revision','User','Status','Notes']]+[[time.strftime('%Y-%m-%d %H:%M:%S',time.gmtime(a['at']/1000)),'SERVER_COMMIT',a['names'],a['revision'],a['actor'],'SUCCESS','ثبت قطعی سرور'] for a in reversed(logs)],'merges':[]}
            p['order'].append('CHANGE_LOG')
        return {'revision':row['revision'],'epoch':row['epoch'],'state':p,'user':user}
    @app.get('/')
    @app.get('/FAM.html')
    def index():return send_file(ROOT/'www'/'FAM.html',mimetype='text/html')
    @app.post('/api/login')
    def login():
        value=data();name=str(value.get('username','')).strip().lower();pw=value.get('password','')
        bucket=hashlib.sha256((name+'|'+(request.remote_addr or '')).encode()).hexdigest();now=int(time.time())
        with transaction() as db:
            attempt=db.execute('SELECT * FROM attempts WHERE bucket=?',(bucket,)).fetchone()
            if attempt and now-attempt['started']<900 and attempt['failures']>=10:fail(429,'تلاش‌های ورود زیاد است؛ ۱۵ دقیقه بعد امتحان کنید.')
            row=db.execute('SELECT * FROM users WHERE username=? AND enabled=1',(name,)).fetchone()
            valid=False
            if isinstance(pw,str) and 4<=len(pw)<=128:
                _,hashed=credentials(pw,row['salt'] if row else '0'*32)
                valid=bool(row and hmac.compare_digest(hashed,row['hash']))
            if not valid:
                start=attempt['started'] if attempt and now-attempt['started']<900 else now
                count=attempt['failures']+1 if attempt and now-attempt['started']<900 else 1
                db.execute('INSERT OR REPLACE INTO attempts VALUES(?,?,?)',(bucket,start,count))
                # Commit failure accounting before returning, not raising/rolling back.
                return jsonify(error='نام کاربری یا رمز عبور نادرست است.'),401
            db.execute('DELETE FROM attempts WHERE bucket=?',(bucket,));db.execute('DELETE FROM sessions WHERE expires<?',(now,))
            token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32)
            db.execute('INSERT INTO sessions VALUES(?,?,?,?,?)',(hashlib.sha256(token.encode()).hexdigest(),row['id'],row['revision'],csrf,now+8*3600))
            response=jsonify(user=public_user(row),csrf=csrf)
            response.set_cookie('fam_session',token,httponly=True,secure=app.config['COOKIE_SECURE'],samesite='Strict',max_age=8*3600,path='/')
            return response
    @app.get('/api/session')
    def session():return jsonify(user=g.user,csrf=g.session['csrf'])
    @app.post('/api/logout')
    def logout():
        with transaction() as db:db.execute('DELETE FROM sessions WHERE token=?',(g.session['token'],))
        r=jsonify(ok=True);r.delete_cookie('fam_session',path='/');return r
    @app.post('/api/reauth')
    def reauth():
        value=data()
        if g.user['role']>2:fail(403,'تأیید مدیر لازم است.')
        with connect() as db:row=db.execute('SELECT * FROM users WHERE id=?',(g.user['id'],)).fetchone()
        _,hashed=credentials(value.get('password',''),row['salt'])
        if not hmac.compare_digest(hashed,row['hash']):fail(403,'رمز نادرست است.')
        return jsonify(ok=True)
    @app.get('/api/status')
    def status():
        # This intentionally exposes only a small, permission-safe change
        # notice. The browser uses it to announce a new central revision;
        # business data itself remains available only through /api/state.
        with connect() as db:
            row=db.execute('SELECT revision,epoch FROM state WHERE id=1').fetchone()
            audit=db.execute('SELECT actor,at FROM audit WHERE revision=?',(row['revision'],)).fetchone()
        change={'revision':row['revision'],'at':audit['at'] if audit else None}
        # Level 4 accounts may receive redacted state, so do not disclose the
        # name of a colleague who changed data outside their permitted scope.
        if audit and g.user['role']<=3:change['actor']=audit['actor']
        return jsonify(revision=row['revision'],epoch=row['epoch'],userRevision=g.user['revision'],change=change)
    @app.get('/api/state')
    def state():
        with connect() as db:
            db.execute('BEGIN');u,_=user_and_session(db);return jsonify(envelope(db,u))
    @app.post('/api/state')
    def commit():
        if g.user['role']==4:fail(403,'این حساب فقط مشاهده می‌کند.')
        body=data();rid=body.get('requestId');base=body.get('revision')
        if not isinstance(rid,str) or not re.fullmatch(r'[a-f0-9-]{36}',rid) or type(base)!=int:fail(400,'شناسه یا نسخهٔ درخواست نامعتبر است.')
        proposed=validate_state(body.get('state'));digest=hashlib.sha256(packed(body).encode()).hexdigest()
        with transaction() as db:
            u,_=user_and_session(db) # Re-authorise after acquiring the write lock.
            if u['role']==4:fail(403,'این حساب فقط مشاهده می‌کند.')
            receipt=db.execute('SELECT * FROM receipts WHERE user_id=? AND request_id=?',(u['id'],rid)).fetchone()
            if receipt:
                if receipt['digest']!=digest:fail(409,'شناسهٔ درخواست با محتوای متفاوت تکرار شده است.')
                return jsonify(json.loads(receipt['response']))
            row=db.execute('SELECT * FROM state WHERE id=1').fetchone()
            if body.get('epoch')!=row['epoch'] or base!=row['revision']:fail(409,'کاربر دیگری داده‌ها را تغییر داده است. تغییر شما ثبت نشد؛ نسخهٔ تازه را دریافت و تغییر را دوباره اعمال کنید.')
            old=json.loads(row['payload']);authorise_change(u,old,proposed)
            revision=row['revision']+1;stamp=int(time.time()*1000)
            names=','.join(n for n in set(old['sheets'])|set(proposed['sheets']) if packed(old['sheets'].get(n))!=packed(proposed['sheets'].get(n)))[:1000]
            db.execute('UPDATE state SET payload=?,revision=?,saved_at=? WHERE id=1',(packed(proposed),revision,stamp))
            db.execute('INSERT INTO audit VALUES(?,?,?,?,?)',(revision,stamp,u['name'],names,row['payload']))
            db.execute("UPDATE audit SET snapshot='' WHERE revision<=? AND snapshot!=''",(revision-50,))
            result={'revision':revision,'epoch':row['epoch'],'savedAt':stamp,'undo':undo_summary(db,revision) if u['role']<=2 else None}
            db.execute('INSERT INTO receipts VALUES(?,?,?,?)',(u['id'],rid,digest,packed(result)))
            return jsonify(result)
    def users_result(db):
        return {'revision':db.execute('SELECT users_revision FROM settings WHERE id=1').fetchone()[0], 'users':[public_user(r) for r in db.execute('SELECT * FROM users ORDER BY username')]}
    @app.get('/api/users')
    def users():
        admin(g.user)
        with connect() as db:
            db.execute('BEGIN');u,_=user_and_session(db);admin(u);return jsonify(users_result(db))
    @app.post('/api/users')
    def save_users():
        body=data();admin(g.user);values=body.get('users')
        if not isinstance(values,list) or not 1<=len(values)<=200:fail(400,'فهرست کاربران نامعتبر است.')
        with transaction() as db:
            u,session=user_and_session(db);admin(u)
            if body.get('revision')!=db.execute('SELECT users_revision FROM settings WHERE id=1').fetchone()[0]:fail(409,'فهرست کاربران تغییر کرده است؛ دوباره باز کنید.')
            old={r['id']:dict(r) for r in db.execute('SELECT * FROM users')};ids=set();names=set();normal=[]
            for x in values:
                if not isinstance(x,dict):fail(400,'کاربر نامعتبر است.')
                uid=x.get('id');name=x.get('username','');display=x.get('name','');role=x.get('role');enabled=x.get('enabled')
                if not isinstance(uid,str) or not re.fullmatch(r'[a-zA-Z0-9-]{10,60}',uid) or uid in ids or not isinstance(name,str) or not re.fullmatch(r'[a-z0-9_.-]{3,40}',name) or name in names or not isinstance(display,str) or not 1<=len(display.strip())<=60 or type(role)!=int or role not in [1,2,3,4] or type(enabled)!=bool:fail(400,'مشخصات کاربر معتبر نیست.')
                ids.add(uid);names.add(name)
                for field in ['regions','sheets']:
                    if not isinstance(x.get(field),list) or len(x[field])>500 or any(not isinstance(v,str) or len(v)>100 for v in x[field]):fail(400,'محدودهٔ کاربر نامعتبر است.')
                previous=old.get(uid);password=x.get('password')
                if previous is None and not password:fail(400,'رمز کاربر جدید لازم است.')
                salt,digest=credentials(password) if password else (previous['salt'],previous['hash'])
                pub={'id':uid,'username':name,'name':display.strip(),'role':role,'enabled':enabled,'regions':x['regions'],'sheets':x['sheets']}
                changed=not previous or password or any(public_user(previous)[k]!=pub[k] for k in pub)
                revision=str(uuid.uuid4()) if changed else previous['revision']
                normal.append((uid,name,display.strip(),role,int(enabled),packed(x['regions']),packed(x['sheets']),revision,salt,digest))
            if not any(v[3]==1 and v[4] for v in normal):fail(400,'حداقل یک مدیر فعال سطح ۱ لازم است.')
            for uid in set(old)-ids:db.execute('DELETE FROM users WHERE id=?',(uid,))
            # Update in-place: REPLACE would cascade-delete active sessions.
            for v in normal:
                db.execute('''INSERT INTO users VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,name=excluded.name,role=excluded.role,enabled=excluded.enabled,regions=excluded.regions,sheets=excluded.sheets,revision=excluded.revision,salt=excluded.salt,hash=excluded.hash''',v)
                if v[0]==u['id'] and v[3]==1 and v[4]:db.execute('UPDATE sessions SET user_revision=? WHERE token=?',(v[7],session['token']))
            db.execute('UPDATE settings SET users_revision=users_revision+1 WHERE id=1')
            return jsonify(users_result(db))
    @app.post('/api/password')
    def change_password():
        value=data()
        if set(value)!={'currentPassword','newPassword'}:fail(400,'فقط تغییر رمز حساب جاری مجاز است.')
        with transaction() as db:
            u,session=user_and_session(db);old=db.execute('SELECT * FROM users WHERE id=?',(u['id'],)).fetchone()
            _,hashed=credentials(value['currentPassword'],old['salt'])
            if not hmac.compare_digest(hashed,old['hash']):fail(403,'رمز فعلی نادرست است.')
            salt,digest=credentials(value['newPassword']);rev=str(uuid.uuid4())
            db.execute('UPDATE users SET salt=?,hash=?,revision=? WHERE id=?',(salt,digest,rev,u['id']))
            db.execute('UPDATE sessions SET user_revision=? WHERE token=?',(rev,session['token']))
            db.execute('UPDATE settings SET users_revision=users_revision+1 WHERE id=1')
            return jsonify(user=public_user(db.execute('SELECT * FROM users WHERE id=?',(u['id'],)).fetchone()))
    return app

if __name__=='__main__':
    from waitress import serve
    serve(create_app(),host=os.environ.get('FAM_BIND','127.0.0.1'),port=int(os.environ.get('FAM_PORT','8765')),threads=16,max_request_body_size=32*1024*1024)
