"""IOS prompt recognition, only fixed paging setup; no enable fallback."""
from ansible_collections.cisco.ios.plugins.terminal.ios import TerminalModule as IosTerminal

class TerminalModule(IosTerminal):
    def on_open_shell(self):
        self._exec_cli_command(b'terminal length 0')

    def on_become(self,passwd=None):
        raise ValueError('Enable / privilege escalation is disabled')
