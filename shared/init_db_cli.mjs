#!/usr/bin/env node
import { initDb } from './local_db.mjs';

console.log(JSON.stringify(initDb(), null, 2));
