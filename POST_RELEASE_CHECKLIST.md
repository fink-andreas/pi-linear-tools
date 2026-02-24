# Post-release verification checklist

## Registry and install checks

```bash
npm view @fink-andreas/pi-linear-tools version
npm install -g @fink-andreas/pi-linear-tools
pi-linear-tools --help
```

## pi package route smoke test

```bash
pi install git:github.com/fink-andreas/pi-linear-tools
# then enable extension resource and run
/linear-tools-help
```

## Basic command smoke test

```bash
pi-linear-tools project list
pi-linear-tools team list
```

## Closeout

- Capture any regressions as follow-up Linear issues
- Post release summary to INN-234
- Mark milestone complete
