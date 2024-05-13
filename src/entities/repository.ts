import { MapEntity, EntityDTO } from './entity';
import type { Rule } from './rule';
import DOMPurify from 'dompurify';

const ENTITY_API_ADDRESS = 'https://placement.freaks.se/api/v1/mapentities';

export interface EntityChanges {
    refreshedDeleted: Array<number>;
    refreshedAdded: Array<number>;
    refreshedUpdated: Array<number>;
}

/**
 * Singleton class that manages entity data from the API
 *
 * Loads all the latest entities on load and when the constraints are changed.
 * The constraints allows limiting what entities are fetched to a given date range.
 */
export class MapEntityRepository {
    private _rulesGenerator: () => Array<Rule>;
    /** Keeps the latest revisions of each unique entity */
    private _latestRevisions: Record<MapEntity['id'], MapEntity> = {};

    /** Possible constraints for the data returned from the API, allows for limiting results between certain dates if set */
    private _entityConstraints: null | {
        earliest: number;
        latest: number;
    } = null;

    /** Indicates that the API has loaded data successfully */
    public loaded: Promise<boolean>;

    /** Loads the latest entity data revisions from the server given the set constraints, if any */
    private async _update(): Promise<void> {
        const res = await fetch(ENTITY_API_ADDRESS);
        const entityDTOs: Array<EntityDTO> = res.ok ? await res.json() : [];
        this._latestRevisions = {};
        for (const data of entityDTOs) {
            if (this._entityConstraints) {
                const { earliest, latest } = this._entityConstraints;
                if (data.timeStamp > latest || data.timeStamp < earliest) {
                    continue;
                }
            }
            this._latestRevisions[data.id] = new MapEntity(data, this._rulesGenerator());
        }
    }

    /** Reloads data */
    public async reload(): Promise<EntityChanges> {
        // Fetch all entities
        const res = await fetch(ENTITY_API_ADDRESS);
        const entityDTOs: Array<EntityDTO> = res.ok ? await res.json() : [];
        const fetchedEntities: Array<MapEntity> = new Array<MapEntity>();
        const refresh: EntityChanges = {
            refreshedDeleted: new Array<number>(),
            refreshedAdded: new Array<number>(),
            refreshedUpdated: new Array<number>(),
        };
        for (const data of entityDTOs) {
            if (this._entityConstraints) {
                const { earliest, latest } = this._entityConstraints;
                if (data.timeStamp > latest || data.timeStamp < earliest) {
                    continue;
                }
            }
            fetchedEntities[data.id] = new MapEntity(data, this._rulesGenerator());
        }

        // Look through old entities for removed entities
        for (const oldEntityIdString in this._latestRevisions) {
            let oldEntityId = parseInt(oldEntityIdString);
            if (fetchedEntities[oldEntityId]) {
                // console.log('Old revision exist in fetched, its not removed');
            } else {
                // console.log('Old revision is removed', oldEntityId);
                refresh.refreshedDeleted.push(oldEntityId);
            }
        }

        // Look through fetched entities for added or new revisions
        for (const fetchedIdString in fetchedEntities) {
            let fetchedId = parseInt(fetchedIdString);
            let fetchedEntity: MapEntity = fetchedEntities[fetchedId];
            // If it's an old enity it must be an update
            if (this._latestRevisions[fetchedId]) {
                // Check if revision has changed
                if (this._latestRevisions[fetchedId].revision < fetchedEntity.revision) {
                    // console.log(`Entity ${entity.id} has revision ${this._latestRevisions[entity.id].revision} new is ${entity.revision}`)
                    this._latestRevisions[fetchedId] = fetchedEntity;
                    refresh.refreshedUpdated.push(fetchedId);
                }
            } else {
                // Added entity
                this._latestRevisions[fetchedId] = fetchedEntity;
                refresh.refreshedAdded.push(fetchedId);
            }
        }
        // console.log(refresh.refreshedAdded, refresh.refreshedDeleted, refresh.refreshedUpdated);
        return refresh;
    }

    constructor(rulesGenerator: () => Array<Rule>) {
        this._rulesGenerator = rulesGenerator;
        // Update on page load
        this.loaded = new Promise((resolve) => this._update().then(() => resolve(true)));
    }

    /** Set the entity constraints, will trigger a reload of the api */
    public async constrain(constraints: MapEntityRepository['_entityConstraints']) {
        this._entityConstraints = constraints;
        await this._update();
    }

    /** Returns the current loaded entities as an array */
    public async entities(): Promise<Array<MapEntity>> {
        // Make sure that the data has been loaded
        await this.loaded;
        // Return the latest revisions as an array
        return Object.values(this._latestRevisions);
    }

    /** Returns a single entity */
    public getEntityById(id: string) {
        return this._latestRevisions[id];
    }

    /** Get all entities as a readonly list */
    public getAllEntities(): ReadonlyArray<MapEntity> {
        return Object.values(this._latestRevisions);
    }

    /** Returns true if this is the latest known revision of the given entity */
    public isLatest(entityData: EntityDTO): boolean {
        return entityData.revision == this._latestRevisions[entityData.id].revision;
    }

    /** Creates a new map entity from the given geoJSON */
    public async createEntity(geoJson: object): Promise<MapEntity | null> {
        console.log('createEntity', geoJson);
        const response = await fetch(ENTITY_API_ADDRESS, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ geoJson: JSON.stringify(geoJson) }),
        });
        if (response.ok) {
            const data: EntityDTO = await response.json();
            console.log('[API]', 'Saved initial entity', data);
            const entity_new = new MapEntity(data, this._rulesGenerator());
            this._latestRevisions[entity_new.id] = entity_new;
            return entity_new;
        } else {
            const err = await response.json();
            console.warn('[API]', 'Failed to save entity', err);
            return null;
        }
    }

    /** Creates a new revision of the current entity in the database */
    public async updateEntity(entity: MapEntity) {
        const response = await fetch(`${ENTITY_API_ADDRESS}/${entity.id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ geoJson: entity.geoJson, id: entity.id }),
        });
        if (response.ok) {
            const data: EntityDTO = await response.json();
            console.log('[API]', 'Updated existing entity', data);
            const entity_updated = new MapEntity(data, this._rulesGenerator());
            this._latestRevisions[entity.id] = entity_updated;
            return entity_updated;
        } else {
            const err = await response.json();
            console.warn('[API]', 'Failed to update entity with id:', entity.id, err);
            return null;
        }
    }

    /** Deletes the entity in the database */
    public async deleteEntity(entity: MapEntity, reason: string = 'No reason given') {
        const response = await fetch(`${ENTITY_API_ADDRESS}/${entity.id}?reason=${DOMPurify.sanitize(reason)}`, {
            method: 'DELETE',
        });
        if (response.ok) {
            console.log('[API]', 'Deleted entity with id:', entity.id);
            delete this._latestRevisions[entity.id];
        } else {
            const err = await response.json();
            console.warn('[API]', 'Failed to delete entity with id:', entity.id, err);
        }
    }

    /** Remove entity, used when an entity has been removed by other */
    public async remove(entity: MapEntity): Promise<void> {
        delete this._latestRevisions[entity.id];
    }

    /** Load all revisions of an entity */
    public async getRevisionsForEntity(entity: MapEntity) {
        const res = await fetch(`${ENTITY_API_ADDRESS}/${entity.id}`);
        const entityDTOs: Array<EntityDTO> = res.ok ? await res.json() : [];
        for (const data of entityDTOs) {
            entity.revisions[data.revision] = new MapEntity(data, this._rulesGenerator());
        }
    }
}
