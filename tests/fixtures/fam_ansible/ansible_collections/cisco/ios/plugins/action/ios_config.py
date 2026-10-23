"""SYNTHETIC TEST ACTION: record safe config arguments, never connect."""
import json
import os
from pathlib import Path
from ansible.plugins.action import ActionBase
class ActionModule(ActionBase):
    def run(self,tmp=None,task_vars=None):
        with Path(os.environ['FAM_SYNTHETIC_TRACE']).open('a') as f:
            f.write(json.dumps({'action':'config','args':dict(self._task.args)})+'\n')
        return {'changed':True}
