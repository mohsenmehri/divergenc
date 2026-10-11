"""TEST ONLY: python -m server.tests.serve_browser (run from repository root).
Uses .cache/fam-browser-test.sqlite3, loopback HTTP, non-Secure test cookies.
Never import production data or expose this test entrypoint to a network.
"""
from pathlib import Path
from waitress import serve
from server.app import create_app

if __name__=='__main__':
    path=Path(__file__).resolve().parents[2]/'.cache'/'fam-browser-test.sqlite3'
    app=create_app({'DB_PATH':str(path),'PUBLIC_ORIGIN':'http://127.0.0.1:8765','TESTING':True,'COOKIE_SECURE':False})
    serve(app,host='127.0.0.1',port=8765,threads=16)
