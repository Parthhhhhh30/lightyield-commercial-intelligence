/* eslint-disable @typescript-eslint/no-explicit-any */
// PUBLIC DEMO ONLY: LightYield's own dependency-free business rules (shared with the Worker), loaded in the browser. Plain JS, so typed loosely here.
// @ts-expect-error -- plain-JS module without type declarations
import * as logic from "../../../src/logic.js";
// @ts-expect-error -- plain-JS module without type declarations
import * as company from "../../../src/company.js";
const L = logic as any, C = company as any;
export const applyReview: (f: any, b: { action: string; value?: string; note?: string }) => { ok: boolean; error?: string; patch?: any } = L.applyReview;
export const syncEligibility: (f: any[]) => { ok: boolean; reason?: string } = L.syncEligibility;
export const selectEvidence: (f: any[]) => any = L.selectEvidence;
export const summariseAccount: (x: { findings: any[]; conversations: any[]; openTasks: number }) => any = L.summariseAccount;
export const validateConversation: (b: any, today: string) => { ok: boolean; errors: string[]; warnings: string[]; value: any } = L.validateConversation;
export const validateTask: (b: any, today: string) => { ok: boolean; errors: string[]; value: any } = L.validateTask;
export const buildAccountDescription: (companyId: string, sel: any, runs: Record<string, { id: string; source_id: string }>) => string = L.buildAccountDescription;
export const buildFindings: (ai: any, source: string, name: string) => { findings: any[]; runFlags: string[] } = L.buildFindings;
export const parseAi: (out: any) => { ok: boolean; value?: any; errors?: string[] } = L.parseAi;
export const presentCompany: (co: any) => any = C.presentCompany;
export const SOURCED: string[] = L.SOURCED;
