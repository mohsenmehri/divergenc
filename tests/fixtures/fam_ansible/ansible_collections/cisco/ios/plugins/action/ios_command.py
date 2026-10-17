"""SYNTHETIC TEST ACTION: no connection method is ever called."""
import json
import os
from pathlib import Path
from ansible.plugins.action import ActionBase

HEADER='Port Name Status Vlan Duplex Speed Type\n'
CLEAN=HEADER+'Gi0/7 Fixture connected 1 auto auto 10/100\nGi0/8 Other disabled 1 auto auto 10/100\n'
ERROR=HEADER+'Gi0/7 Fixture err-disabled 1 auto auto 10/100\nGi0/8 Other disabled 1 auto auto 10/100\n'
class ActionModule(ActionBase):
    def run(self,tmp=None,task_vars=None):
        trace=Path(os.environ['FAM_SYNTHETIC_TRACE'])
        events=[json.loads(line) for line in trace.read_text().splitlines()] if trace.exists() else []
        count=sum(e['action']=='read' for e in events)
        with trace.open('a') as f:f.write(json.dumps({'action':'read','commands':self._task.args['commands']})+'\n')
        scenario=os.environ.get('FAM_SYNTHETIC_SCENARIO','recovered')
        if scenario=='connection_failed':return {'failed':True,'msg':'SYNTHETIC RAW DIAGNOSTIC MUST NOT LEAK'}
        if scenario=='malformed':return {'changed':False,'stdout':[HEADER+'Gi0/7 truncated err-disabled\n']}
        if scenario=='clean':out=CLEAN
        elif scenario=='missing_post' and count:out=HEADER+'Gi0/8 Other connected 1 auto auto 10/100\n'
        elif scenario=='still':out=ERROR
        else:out=ERROR if count==0 else CLEAN
        return {'changed':False,'stdout':[out]}
