import { db } from 'hatchable';
export const query = (text, params = []) => db.query(text, params);
export const transaction = (stmts) => db.transaction(stmts);
