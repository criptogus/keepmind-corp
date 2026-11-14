"""Install stable runtime and per-user LaunchAgent; bootstrap separately after stopping old bridge."""
from pathlib import Path
import shutil, plistlib, os
project=Path(__file__).resolve().parents[1]
bun=shutil.which('bun')
if not bun: raise SystemExit('Bun must be installed and available on PATH')
home=Path.home(); runtime=home/'Library/Application Support/keepmind/brain-service'
logs=home/'Library/Logs/KeepMind'; agents=home/'Library/LaunchAgents'
for d in [runtime,logs,agents]: d.mkdir(parents=True,exist_ok=True)
runtime.chmod(0o700);logs.chmod(0o700)
if not (project/'dist/client/index.html').exists(): raise SystemExit('Build UI first: bun run build:native')
shutil.copytree(project/'backend',runtime/'backend',dirs_exist_ok=True)
shutil.copytree(project/'dist/client',runtime/'dist/client',dirs_exist_ok=True)
for dependency in ['libsodium-wrappers-sumo','libsodium-sumo']:
 shutil.copytree((project/'node_modules'/dependency).resolve(),runtime/'node_modules'/dependency,dirs_exist_ok=True)
config={'Label':'io.keepmind.brain','ProgramArguments':[bun,str(runtime/'backend/server.mjs')],
 'WorkingDirectory':str(runtime),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':60,
 'ProcessType':'Background','LimitLoadToSessionType':'Aqua',
 'EnvironmentVariables':{'HOME':str(home),'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','KEEPMIND_BACKGROUND':'1'},
 'StandardOutPath':str(logs/'brain.log'),'StandardErrorPath':str(logs/'brain-error.log')}
path=agents/'io.keepmind.brain.plist'
if path.exists():shutil.copy2(path,path.with_suffix('.plist.backup'))
with path.open('wb') as f:plistlib.dump(config,f)
path.chmod(0o600)
print(path)
