-- Delete seeded dummy website reviews with no registered customer_id
DELETE FROM website_reviews WHERE customer_id IS NULL;
