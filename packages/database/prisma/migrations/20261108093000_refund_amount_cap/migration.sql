-- A refund can never exceed the payment it refunds.
CREATE FUNCTION refund_amount_cap() RETURNS trigger AS $$
DECLARE paid bigint;
BEGIN
  SELECT "amountMinor" INTO paid FROM "payment" WHERE "id" = NEW."paymentId";
  IF paid IS NULL OR NEW."amountMinor" > paid THEN
    RAISE EXCEPTION 'refund exceeds the payment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER refund_amount_cap BEFORE INSERT ON "refund" FOR EACH ROW EXECUTE FUNCTION refund_amount_cap();
