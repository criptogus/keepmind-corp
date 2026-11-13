import { it, expect, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const fake=vi.hoisted(()=>({appData:'',switchValue:'',setPath:vi.fn()}))
vi.mock('electron',()=>({app:{getPath:()=>fake.appData,commandLine:{getSwitchValue:()=>fake.switchValue},setPath:fake.setPath}}))
import { configureProfile } from '../src/main/services/profile'
it('keeps existing data identities across the KeepMind SB rename, with separate Corp data',()=>{
  fake.appData=mkdtempSync(join(tmpdir(),'km-profile-'));const original=process.env.KEEPMIND_USER_DATA_DIR;delete process.env.KEEPMIND_USER_DATA_DIR
  try {
    configureProfile();expect(fake.setPath).toHaveBeenLastCalledWith('userData',join(fake.appData,'keepmind'))
    configureProfile('corp');expect(fake.setPath).toHaveBeenLastCalledWith('userData',join(fake.appData,'keepmind-corp'))
    fake.switchValue=join(fake.appData,'isolated');configureProfile();expect(fake.setPath).toHaveBeenLastCalledWith('userData',fake.switchValue)
    process.env.KEEPMIND_USER_DATA_DIR=join(fake.appData,'inherited');configureProfile();expect(fake.setPath).toHaveBeenLastCalledWith('userData',process.env.KEEPMIND_USER_DATA_DIR)
  }finally{fake.switchValue='';if(original===undefined)delete process.env.KEEPMIND_USER_DATA_DIR;else process.env.KEEPMIND_USER_DATA_DIR=original;rmSync(fake.appData,{recursive:true,force:true})}
})
