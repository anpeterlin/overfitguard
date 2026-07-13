---
name: Bug report
about: A wrong verdict, a crash, or behavior that doesn't match the docs
title: "[bug] "
labels: bug
---

**What happened**
<!-- The verdict/number/error you got. -->

**What you expected**
<!-- What the docs or your reasoning led you to expect. -->

**Minimal reproduction**
<!-- Ideally a short snippet. Please don't paste real strategy data you can't share — a synthetic
     series that reproduces the issue is perfect. -->

```python
import numpy as np, pandas as pd
from overfitguard import validate
# ...
```

**Environment**
- OverfitGuard version (`python -c "import overfitguard; print(overfitguard.__version__)"`):
- Python / numpy / pandas versions:
- Or, for the browser app: browser + version.
