"""Verify actual IIS HTTPS/SNI/hostname + reverse-proxied FAM API, without
logging in as a real user or disabling TLS verification. DNS is checked separately.
Only the explicitly selected public certificate is added to this probe's trust.
"""
import argparse
import hashlib
import http.client
import json
from pathlib import Path
import secrets
import socket
import ssl
import time

class DirectHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, address, context, port=443):
        super().__init__(host, port=port, timeout=15, context=context)
        self.address=address
    def connect(self):
        raw=socket.create_connection((self.address,self.port),self.timeout)
        try:self.sock=self._context.wrap_socket(raw,server_hostname=self.host)
        except BaseException:raw.close();raise

def probe(host,address,cert_path,port=443):
    der=Path(cert_path).read_bytes()
    context=ssl.create_default_context()
    context.load_verify_locations(cadata=ssl.DER_cert_to_PEM_cert(der))
    # Trust exactly the operator-selected certificate as a possible chain anchor.
    context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
    context.minimum_version=ssl.TLSVersion.TLSv1_2
    assert context.check_hostname and context.verify_mode==ssl.CERT_REQUIRED
    checks=[]
    def request(method,path,body=None,expected=200):
        conn=DirectHTTPS(host,address,context,port)
        headers={'Host':host,'Connection':'close'}
        if body is not None:headers.update({'Content-Type':'application/json','Origin':'https://'+host})
        try:
            conn.request(method,path,body=json.dumps(body) if body is not None else None,headers=headers)
            response=conn.getresponse();data=response.read(5*1024*1024)
            if response.status!=expected:raise RuntimeError(f'{method} {path}: expected {expected}, received {response.status}')
            if path.startswith('/api/'):
                if 'no-store' not in response.getheader('Cache-Control',''):raise RuntimeError('API response must not be cached')
                parsed=json.loads(data)
                if not isinstance(parsed,dict) or not parsed.get('error'):raise RuntimeError('Expected a FAM authentication error, not an IIS/static fallback')
            checks.append(f'{method} {path}: {response.status}')
            return data
        finally:conn.close()
    html=request('GET','/')
    if b'fam-shared-js' not in html:raise RuntimeError('IIS is not serving the CENTRAL FAM client')
    request('GET','/api/session',expected=401)
    # No genuine credentials. Checks that PUBLIC_ORIGIN and POST proxying work.
    request('POST','/api/login',{'username':'health-probe-'+secrets.token_hex(8),'password':secrets.token_urlsafe(24)},expected=401)
    return {'httpsApiVerified':True,'hostname':host,'address':address,'selectedCertificateSHA256':hashlib.sha256(der).hexdigest(),'checks':checks,'clientTrustVerified':False}

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--host',required=True);p.add_argument('--address',required=True);p.add_argument('--cert',required=True);p.add_argument('--output',required=True)
    args=p.parse_args();result={}
    for attempt in range(3):
        try:result=probe(args.host,args.address,args.cert);break
        except Exception as e:
            result={'httpsApiVerified':False,'error':str(e)}
            if attempt<2:time.sleep(2)
    Path(args.output).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps(result,ensure_ascii=False))
    return 0 if result['httpsApiVerified'] else 1

if __name__=='__main__':raise SystemExit(main())
