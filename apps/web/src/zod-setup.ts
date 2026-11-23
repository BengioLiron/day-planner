import { z } from "zod";

// Validation without eval(): the server's security policy forbids it.
// This module is imported first in main.tsx, because schemas check the
// setting when they are created, and some are created at import time.
z.config({ jitless: true });
