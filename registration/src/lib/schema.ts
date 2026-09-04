/**
 * Typed mirror of the database.
 *
 * The SQL migration in supabase/migrations is the source of truth for the schema,
 * because the things that matter here are constraints: partial unique indexes,
 * check constraints and row level security policies. Those express intent far
 * better in SQL than in a builder API, and they are what the reviewer will read.
 *
 * This file exists so queries are typed. If the two ever disagree, the SQL wins.
 */
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  bigserial,
} from "drizzle-orm/pg-core";

export const staff = pgTable("staff", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").notNull().unique(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const parents = pgTable("parents", {
  id: uuid("id").primaryKey().defaultRandom(),
  authUserId: uuid("auth_user_id").unique(),
  email: text("email").notNull().unique(),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const children = pgTable("children", {
  id: uuid("id").primaryKey().defaultRandom(),
  parentId: uuid("parent_id").notNull(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  dateOfBirth: date("date_of_birth").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const schools = pgTable("schools", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("Pacific/Honolulu"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const classOfferings = pgTable("class_offerings", {
  id: uuid("id").primaryKey().defaultRandom(),
  schoolId: uuid("school_id").notNull(),
  title: text("title").notNull(),
  summary: text("summary"),
  term: text("term").notNull(),
  weekday: integer("weekday").notNull(),
  startTime: time("start_time").notNull(),
  endTime: time("end_time").notNull(),
  weeks: integer("weeks").notNull(),
  firstSessionDate: date("first_session_date").notNull(),
  capacity: integer("capacity").notNull(),
  seatsTaken: integer("seats_taken").notNull().default(0),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("published"),
  stripeProductId: text("stripe_product_id"),
  stripePriceId: text("stripe_price_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  classOfferingId: uuid("class_offering_id").notNull(),
  seq: integer("seq").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  status: text("status").notNull().default("scheduled"),
  rescheduledFrom: uuid("rescheduled_from"),
  note: text("note"),
});

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    status: text("status").notNull().default("pending"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    fulfilledAt: timestamp("fulfilled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("orders_idempotent").on(t.parentId, t.idempotencyKey)],
);

export const orderItems = pgTable("order_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull(),
  classOfferingId: uuid("class_offering_id").notNull(),
  childId: uuid("child_id").notNull(),
  unitPriceCents: integer("unit_price_cents").notNull(),
  stripePriceId: text("stripe_price_id"),
  startsFromSessionId: uuid("starts_from_session_id"),
});

export const seatHolds = pgTable(
  "seat_holds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderItemId: uuid("order_item_id").notNull().unique(),
    classOfferingId: uuid("class_offering_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("seat_holds_expiry").on(t.expiresAt)],
);

export const enrollments = pgTable("enrollments", {
  id: uuid("id").primaryKey().defaultRandom(),
  classOfferingId: uuid("class_offering_id").notNull(),
  childId: uuid("child_id").notNull(),
  orderItemId: uuid("order_item_id"),
  status: text("status").notNull().default("active"),
  startsFromSessionId: uuid("starts_from_session_id"),
  refundOwed: boolean("refund_owed").notNull().default(false),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  cancellationReason: text("cancellation_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
});

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
  error: text("error"),
});

export const enrollmentEvents = pgTable("enrollment_events", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  enrollmentId: uuid("enrollment_id"),
  orderId: uuid("order_id"),
  event: text("event").notNull(),
  payload: jsonb("payload"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
