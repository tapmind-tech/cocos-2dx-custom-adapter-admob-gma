## Summary

<!-- What changed and why. -->

## Versions

| Field | Value |
| --- | --- |
| Extension (`ads_admob_cocos2dx/package.json`) | |
| Default Android adapter (`inject.js`) | |
| Default iOS adapter (`inject.js`) | |

## Checklist

- [ ] `ads_admob_cocos2dx/package.json` `version` bumped when this PR ships a release (`feat` → MINOR, `fix` → PATCH, breaking → MAJOR).
- [ ] Root `CHANGELOG.md` has a dated section for that same version with at least one bullet.
- [ ] If shipping against a newer Maven/CocoaPods adapter, `ADAPTER.*.defaultVersion` in `inject.js` was updated and noted in the CHANGELOG.
- [ ] PR is `dev` → `main` (other source branches are rejected by `merge_gate`).
- [ ] Verify workflow is green (`merge_gate`, `analyze_and_test`, `suspicious_code_scan`).
