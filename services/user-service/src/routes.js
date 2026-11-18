import { Router } from 'express';
import { HttpError } from './lib/errors.js';
import { positiveInt, nonEmptyString, pagination } from './lib/validate.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function usersRouter({ repo }) {
  const router = Router();

  // POST /users  {name, email}  -> 201 created | 400 invalid | 409 duplicate
  router.post('/', async (req, res) => {
    const name = nonEmptyString(req.body?.name, 'name');
    const email = nonEmptyString(req.body?.email, 'email', 320).toLowerCase();
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'email is invalid');
    const user = await repo.create({ name, email });
    res.status(201).location(`/users/${user.id}`).json(user);
  });

  // GET /users?limit=&offset=
  router.get('/', async (req, res) => {
    res.json(await repo.list(pagination(req.query)));
  });

  // GET /users/:id  (order-service calls this to check the customer exists)
  router.get('/:id', async (req, res) => {
    const user = await repo.findById(positiveInt(req.params.id, 'id'));
    if (!user) throw new HttpError(404, 'user not found');
    res.json(user);
  });

  return router;
}
