-- Drop redundant unit resident fks.

DO $redundant_fks$
DECLARE
  redundant record;
BEGIN
  FOR redundant IN
    SELECT single.conname, single.conrelid::regclass AS child_table
    FROM pg_constraint single
    WHERE single.contype = 'f'
      AND cardinality(single.conkey) = 1
      AND single.confrelid IN ('public.units'::regclass, 'public.residents'::regclass)
      AND EXISTS (
        SELECT 1
        FROM pg_constraint composite
        WHERE composite.contype = 'f'
          AND composite.conrelid = single.conrelid
          AND composite.confrelid = single.confrelid
          AND cardinality(composite.conkey) = 2
          AND single.conkey[1] = ANY (composite.conkey)
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE %s DROP CONSTRAINT %I',
      redundant.child_table,
      redundant.conname
    );
    RAISE NOTICE 'Dropped redundant single-column FK % on %',
      redundant.conname, redundant.child_table;
  END LOOP;
END
$redundant_fks$;

-- PostgREST caches the schema; without this the ambiguity persists until the
-- connection pool happens to refresh.
NOTIFY pgrst, 'reload schema';
