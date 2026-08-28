import { register } from 'node:module'

register('./srcAliasLoader.js', import.meta.url)
