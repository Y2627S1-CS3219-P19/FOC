# Adding order-service to the root npm workspace

Do these together in one PR (they touch files outside `order-service/`).

1. Root `package.json`:
   - add `"order-service"` to `workspaces`
   - add `-w order-service` to the `build`, `typecheck` and `test` scripts
2. `order-service/package.json`: change both `"file:../packages/..."` dependencies to `"*"`, like the other services.
3. Run `npm install` at the root to update `package-lock.json`. This also installs ESLint and Prettier for
   `npm run lint` / `npm run format:check`.
4. Every service Dockerfile (`user-service`, `supplier-service`, `credit-service`, `order-service`) copies every
   workspace `package.json` before `npm ci`. Add this line to each of them, next to the other `COPY .../package.json` lines:

   ```dockerfile
   COPY order-service/package.json order-service/
   ```

5. In `order-service/Dockerfile`, the build step can then use `npm run build -w order-service` instead of calling
   `tsc` directly.
6. Paste `compose.order.yaml`, `nginx.order.conf` and `env.order.example` (in this folder) into their files.
