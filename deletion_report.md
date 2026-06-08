# Vishwakarma (AVK) Removal Report

This report outlines all Vishwakarma-related components and logic to be removed from the NavBharatAI codebase in order to completely eradicate the AVK system while preserving all infrastructure-level secrets, keys, and cloud configurations.

## 1. Inventory of Vishwakarma-Related Files and References

### Components/Files
- `./src/components/ide/GitPanel.tsx` (Contains agent activation logic for Vishwakarma tiers, modals)
- `./src/components/ide/AgentSelector.tsx` (Contains Vishwakarma agent selector options)
- `./src/components/ide/CodeStudio.tsx` (Contains Vishwakarma-related props and logic)
- `./src/components/ide/AIChat.tsx` (Contains Vishwakarma chat rendering, lock guards, and key assistant branding)
- `./src/components/home/HomeView.tsx` (Likely contains Vishwakarma marketing/UI)
- `./src/server/AI/AIRuntimeManager.ts` (Defines Vishwakarma AI tiers)
- `./src/App.tsx` (Contains extensive state, logic, and component props for Vishwakarma, including localStorage interactions, login gates, and promo logic)
- `./server.ts` (Contains Vishwakarma AI contexts, payment logic related to Vishwakarma passes, and mode validation)

### Key References to Remove/Neutralize
- `vishwakarma` (all strings)
- `avk`
- `asc_chat`
- `ascAgent`
- `vishwakarma_basic`
- `vishwakarma_pro`
- `vishwakarma_vip`
- `hasVishwakarmaPass`
- `showVishwakarmaUnlockModal`
- `buyPass`
- `isVishwakarma`

## 2. Dependency Analysis (NavBharatAI Dependency Check)
NavBharatAI functionality currently relies on `activeAgent`, `activeView`, and `messages`. 
The removal strategy will decouple these from any Vishwakarma-specific state or logic in `App.tsx` and `server.ts`. 

- `App.tsx` is the central hub. I will focus on removing state variables and simplifying `handleAgentChange` and `useEffect` hooks.
- `server.ts` needs to be cleaned of tier definitions and payment logic that gated Vishwakarma pass.

## 3. Plan for Deletion/Cleanup
1. **Clean internal logic first**: `server.ts`, `AIRuntimeManager.ts`
2. **Clean application state**: `App.tsx`
3. **Clean UI components**: Remove everything listed above.
4. **Fix build errors**: Final TypeScript/lint pass.

## 4. Infrastructure Preservation
As per instructions, NO secrets, API keys, Environment variables, or Cloud Run configs will be modified.

---
*Status: Ready for execution.*
