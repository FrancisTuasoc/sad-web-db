-- Allow guest product reviews / star ratings by dropping NOT NULL on customer_id
ALTER TABLE reviews ALTER COLUMN customer_id DROP NOT NULL;
