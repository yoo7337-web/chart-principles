import sys, urllib.request
def line(name, fn):
    try:
        r = fn(); print(f"PROBE {name}: OK -> {r}")
    except Exception as e:
        print(f"PROBE {name}: FAIL -> {type(e).__name__}: {str(e)[:120]}")

def yf_test():
    import yfinance as yf
    d = yf.download("^KS11", period="5d", progress=False)
    return f"{len(d)} rows, last={d['Close'].dropna().iloc[-1].item():.0f}"

def pykrx_test():
    from pykrx import stock
    d = stock.get_market_ohlcv("20260601","20260710","005930")
    return f"{len(d)} rows"

def naver_sise():
    req=urllib.request.Request("https://finance.naver.com/sise/sise_market_sum.naver?sosok=0&page=1", headers={"User-Agent":"Mozilla/5.0"})
    h=urllib.request.urlopen(req,timeout=15).read().decode("euc-kr","ignore")
    import re; return f"{len(re.findall(r'code=(\d{6})',h))} codes"

def naver_frgn():
    req=urllib.request.Request("https://finance.naver.com/item/frgn.naver?code=005930&page=1", headers={"User-Agent":"Mozilla/5.0"})
    h=urllib.request.urlopen(req,timeout=15).read().decode("euc-kr","ignore")
    return f"{len(h)} bytes"

line("yfinance", yf_test)
line("pykrx", pykrx_test)
line("naver_sise", naver_sise)
line("naver_frgn", naver_frgn)
