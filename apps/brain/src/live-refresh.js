export async function loadLiveData(api, callbacks) {
 const {mounted,setStatus,setToday,setNotes,setLearnings,setSkills,setJobs,setExecutions,setSkillsError,setSkillsLoaded}=callbacks;
 let failed=false;
 const setError=message=>{failed=true;callbacks.setError(message)};
      const s=await api("/status");
      if(!mounted.current)return;
      setStatus(s);
      const todayTask=api("/today").then(value=>{if(mounted.current)setToday(value)}).catch(e=>{if(mounted.current){setToday(null);setError(e.message)}});
      if(s.unlocked){
        const setters=[setNotes,setLearnings,setSkills,setJobs,setExecutions];
        await Promise.allSettled(["/notes","/learnings","/skills","/jobs","/proposal/executions"].map(async(path,i)=>{
          try{const value=await api(path);if(mounted.current){setters[i](value);if(i===2){setSkillsError(false);setSkillsLoaded(true)}}}
          catch(e){if(mounted.current){setters[i]([]);if(i===2){setSkillsError(true);setSkillsLoaded(true)}setError(e.message)}}
        }));
      }else{setNotes([]);setLearnings([]);setSkills([]);setSkillsLoaded(false);setJobs([]);setExecutions([])}
      await todayTask;
      if(mounted.current&&!failed)callbacks.setError("");
}
