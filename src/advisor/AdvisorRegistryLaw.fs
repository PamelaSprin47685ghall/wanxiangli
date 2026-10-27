module Wanxiangli.Advisor.AdvisorRegistryLaw

type AdvisorRegistryLawShape =
    { ContractVersion: int
      DefaultTimeoutMs: int }

let AdvisorRegistryLaw : AdvisorRegistryLawShape =
    { ContractVersion = 1
      DefaultTimeoutMs = 120_000 }
