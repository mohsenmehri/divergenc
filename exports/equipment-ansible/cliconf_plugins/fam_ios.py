"""Narrow IOS adapter: no automatic version/VLAN/config discovery or free CLI."""
import json
import re
from ansible_collections.cisco.ios.plugins.cliconf.ios import Cliconf as IosCliconf

DOCUMENTATION = '''
name: fam_ios
short_description: Fixed FAM port inspection and recovery only
description:
  - Reuses Cisco IOS parsing/diff support but forbids unrelated device discovery.
author: FAM
'''

class Cliconf(IosCliconf):
    def get_device_info(self):
        # Stock IOS capability discovery reads show version/show vlan. Not here.
        return {'network_os':'ios'}

    def get_capabilities(self):
        return json.dumps({'rpc':['get','run_commands','get_diff','edit_config'],
                           'device_info':self.get_device_info(),'network_api':'cliconf',
                           'device_operations':self.get_device_operations(),
                           **self.get_option_values()})

    def get(self,command=None,**kwargs):
        if command!='show interfaces status':raise ValueError('Command not permitted')
        return super().get(command=command,**kwargs)

    def run_commands(self,commands=None,check_rc=True):
        if not isinstance(commands,list) or len(commands)!=1:
            raise ValueError('Command not permitted')
        item=commands[0]
        command=item.get('command') if isinstance(item,dict) else item
        if command!='show interfaces status':raise ValueError('Command not permitted')
        # ios_command transforms strings into command dictionaries. Never forward
        # their prompt/answer/sendonly options, which could become extra CLI input.
        return [self.send_command('show interfaces status')]

    def get_config(self,*args,**kwargs):
        raise ValueError('Full configuration collection is not permitted')

    def edit_config(self,candidate=None,commit=True,replace=None,comment=None):
        lines=[line.strip() for line in candidate] if isinstance(candidate,list) and all(isinstance(line,str) for line in candidate) else []
        if (not commit or replace or comment or len(lines)!=3 or
                not re.fullmatch(r'interface [A-Za-z][A-Za-z0-9/.-]{0,63}',lines[0]) or
                not any(c.isdigit() for c in lines[0]) or lines[1:]!=['shutdown','no shutdown']):
            raise ValueError('Only an exact single-interface recovery is permitted')
        # Do not issue enable: an already-authorized privileged account is required.
        if not self._connection.get_prompt().strip().endswith(b'#'):
            raise ValueError('Already-privileged account required; enable is disabled')
        responses=[]
        try:
            self.send_command('configure terminal')
            for line in lines:responses.append(self.send_command(line))
        finally:
            self.send_command('end')
        return {'request':lines,'response':responses}

    def edit_banner(self,*args,**kwargs):
        raise ValueError('Command not permitted')

    def get_defaults_flag(self):
        raise ValueError('Full configuration collection is not permitted')
