// viberoom - Copyright (c) 2026 Todor Rusev - AGPL-3.0-or-later; see LICENSE
import { fileURLToPath } from "node:url";
import { writeBuildStamp } from "../dist/build-stamp.js";

writeBuildStamp(fileURLToPath(new URL("../dist/", import.meta.url)));
