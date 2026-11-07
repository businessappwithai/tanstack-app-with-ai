# SANDBOX ONLY. Appends an egress proxy's CA (certs 117+ of /root/.ccr/ca-bundle.crt) to each stage of the
# QA copy's Dockerfiles, because the image build does not trust it, and builds the reporting platform
# from the branch named in REPORT_REF. Never use it to turn verification off: it adds a trusted CA.
import re,sys,pathlib
root=pathlib.Path(sys.argv[1])
pem=open('/root/.ccr/ca-bundle.crt').read()
certs=re.findall(r'-----BEGIN CERTIFICATE-----.*?-----END CERTIFICATE-----',pem,re.S)[117:]
blob="\n".join(certs)+"\n"
ins=("RUN mkdir -p /etc/ssl/certs && cat >> /etc/ssl/certs/ca-certificates.crt <<'QAEOF'\n"+blob+"QAEOF\n"
     "ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt\n")
for f in ["Dockerfile","backend/Dockerfile","frontend/Dockerfile","reporting/Dockerfile"]:
    p=root/f
    s=p.read_text()
    if "QAEOF" in s: continue
    out=[]
    for line in s.splitlines(True):
        out.append(line)
        if line.startswith("FROM ") and " AS bun" not in line: out.append(ins)
    p.write_text("".join(out))
    print("patched",f)

# QA: build the reporting platform from the branch carrying the refusal fix (REPORT_REF is a
# documented .env setting; the zip's default is main).
with open(root/".env","a") as f:
    f.write("\nREPORT_REF=ccr-c831e6e5-br2r5f\n")
print("REPORT_REF set in .env")
