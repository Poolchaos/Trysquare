## What this changes

One or two sentences. If it relates to an issue or a work package in
`docs/plans/BUILD-PLAN.md`, name it.

## Why

## Evidence it works

Not "tests pass", but what you ran and what it printed. For a bug fix, show
how you confirmed the old behaviour was wrong and the new behaviour is right.

```
paste output here
```

## Checklist

- [ ] `./verify.sh` exits 0 (add `--build` if the build is affected, `--e2e`
      if UI or pipeline behaviour is affected)
- [ ] One change, not several bundled together
- [ ] Any documentation my change made wrong is corrected in this PR
- [ ] No test was weakened or deleted to make this pass
- [ ] No new dependency, or the PR explains why one was needed
