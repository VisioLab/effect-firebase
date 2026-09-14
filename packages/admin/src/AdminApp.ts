/**
 * The Firebase Admin SDK app.
 *
 * @since 0.0.0
 */
import { Context } from "effect";
import * as Admin from "firebase-admin/app";

/**
 * A Firebase Admin SDK app.
 *
 * @category models
 * @since 0.0.0
 */
export interface AdminApp extends Admin.App {}

/**
 * Service key for the Firebase Admin SDK app.
 *
 * @category services
 * @since 0.0.0
 */
export const AdminApp = Context.Service<AdminApp>("@effect-firebase/admin/AdminApp");
