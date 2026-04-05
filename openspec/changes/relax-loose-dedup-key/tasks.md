## 1. Update loose dedup key functions

- [x] 1.1 Modify `makeLooseDedupKey_` to accept only `{ bank, dt, amount }`, remove `last4` parameter, and format datetime as `yyyy/MM/dd HH:mm`
- [x] 1.2 Modify `makeLooseDedupKeyFromRow_` to stop reading `last4` from column D, build key using only bank, dt (minute precision), and amount

## 2. Update call sites

- [x] 2.1 Update Fubon call site to pass `{ bank: '富邦', dt, amount }` without `last4`
- [x] 2.2 Update Cathay consumption call site to pass `{ bank: '國泰', dt, amount }` without `last4`
- [x] 2.3 Update Cathay transfer call site to pass `{ bank: '國泰', dt, amount }` without `last4`

## 3. Verification

- [x] 3.1 Verify strict dedup key (`makeDedupKey_`) is unchanged and still includes all original fields
- [x] 3.2 Verify JSDoc comments on `makeLooseDedupKey_` reflect the updated signature and behavior
