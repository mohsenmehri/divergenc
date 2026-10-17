"""Minimal stdout: allow only validated summaries, never raw failure details."""
import json
from ansible.plugins.callback import CallbackBase

class CallbackModule(CallbackBase):
    CALLBACK_VERSION = 2.0
    CALLBACK_TYPE = 'stdout'
    CALLBACK_NAME = 'fam_safe'
    SAFE_REPORTS = {
        'Show only validated destination IP and interface for operator review',
        'Report sanitized port status, never raw CLI, banners or credentials',
        'Report only validated host, port and outcome',
    }

    def v2_runner_on_ok(self,result):
        if (result._task.get_name() in self.SAFE_REPORTS and
                not result._result.get('_ansible_no_log',False)):
            self._display.display(json.dumps(result._result.get('msg'),ensure_ascii=False))

    def v2_runner_on_failed(self,result,ignore_errors=False):
        self._display.display('FAILED: operation not verified; raw diagnostics suppressed.')

    def v2_runner_on_unreachable(self,result):
        self._display.display('UNKNOWN: connection not verified; raw diagnostics suppressed.')

    def v2_playbook_on_stats(self,stats):
        failed=bool(sum(stats.failures.values())+sum(stats.dark.values()))
        self._display.display('FAM result: '+('FAILED / UNKNOWN' if failed else 'completed'))
