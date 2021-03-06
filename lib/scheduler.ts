import * as _ from 'lodash';

import { getInstanceKey, getActionKey } from './utils';
import { Cache } from './cache';
import { PendingAction } from './abstract';
import { ResourceService } from './resourceService';
import { ActionMetadata, ResourceMetadata } from './metadata';

/** @internal */
export class ActionsScheduler {

  private intervalId: any;

  constructor(
    private storage: LocalForage,
    private config: ResourceMetadata,
    private resource: ResourceService,
    private cache: Cache
  ) {
    if (this.config.networkState.isOnline) {
      this.enableAttempts();
      this.checkPendingActions();
    }

    this.config.networkState.setOnlineHandler(() => {
      this.checkPendingActions();
      this.enableAttempts();
    });

    this.config.networkState.setOfflineHandler(() => {
      this.disableAttempts();
    });
  }

  private async checkPendingActions() {
    if (!this.config.networkState.isOnline) {
      return;
    }

    const actionKeys = _(await this.storage.keys()).filter(key => /^action/.test(key)).value();
    const deleted = [];

    const actions = actionKeys.map(async (actionKey: string) => {
      const action = await this.storage.getItem<PendingAction>(actionKey);
      const instanceKey = getInstanceKey(this.config, action.cacheParams);
      const instance = await this.storage.getItem(instanceKey);

      if (!instance) {
        return await this.storage.removeItem(actionKey);
      }

      const resource = await this.resource.invoke(action.action, action.httpParams, instance, { httpOnly: true } as ActionMetadata);
      resource.$storagePromise.catch(() => { });

      await resource.$httpPromise;
      await this.storage.removeItem(actionKey);
      await this.storage.removeItem(instanceKey);

      deleted.push(action.cacheParams);
    });

    await Promise.all(actions);

    await this.cache.removeFromArrays(deleted);
  }

  public async addAction(cacheParams: {}, action: PendingAction) {
    await this.storage.setItem(getActionKey(cacheParams), action);
  }

  public async removeAction(cacheParams: {}) {
    await this.storage.removeItem(getActionKey(cacheParams));
  }

  public async clear() {
    let keys = await this.storage.keys();
    keys.filter(key => /^action/.test(key));

    await Promise.all(keys.map(key => this.storage.removeItem(key)));
  }

  private enableAttempts() {
    this.intervalId = setInterval(() => this.checkPendingActions(), this.config.reattemptInterval);
  }

  private disableAttempts() {
    clearInterval(this.intervalId);
  }
}