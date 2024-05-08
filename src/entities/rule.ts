import * as Turf from '@turf/turf';
import type { MapEntity } from './entity';
import { Geometry } from 'geojson';
import { GeoJSON } from 'leaflet';
import * as L from 'leaflet';

const MAX_CLUSTER_SIZE: number = 1250;
const MAX_POWER_NEED: number = 8000;
const MAX_POINTS_BEFORE_WARNING: number = 10;
const FIRE_BUFFER_IN_METER: number = 5;

export class Rule {
    private _severity: 0 | 1 | 2 | 3;
    private _triggered: boolean;
    private _callback: (entity: MapEntity) => { triggered: boolean, shortMessage?: string, message?: string };

    public message: string;
    public shortMessage: string;

    public get severity(): number {
        return this._triggered ? this._severity : 0;
    }

    public get triggered(): boolean {
        return this._triggered;
    }

    public checkRule(entity: MapEntity) {
        const result = this._callback(entity);
        this._triggered = result.triggered;
        if (result.shortMessage) this.shortMessage = result.shortMessage;
        if (result.message) this.message = result.message;
    }

    constructor(severity: Rule['_severity'], shortMessage: string, message: string, callback: Rule['_callback']) {
        this._severity = severity;
        this._triggered = false;
        this._callback = callback;

        this.shortMessage = shortMessage;
        this.message = message;
    }
}

/** Utility function to generate a rule generator function to be used with the editor */
export function generateRulesForEditor(groups: any, placementLayers: any): () => Array<Rule> {
    return () => [
        // isBiggerThanNeeded(),
        // isSmallerThanNeeded(),
        // isCalculatedAreaTooBig(),
        hasLargeEnergyNeed(),
        fastOverlap(placementLayers, 3, "yo","yooo"),
        // hasMissingFields(),
        // hasManyCoordinates(),
        // isBreakingSoundLimit(groups.soundguide, 2, 'Making too much noise?', 'Seems like you wanna play louder than your neighbors might expect? Check the sound guider layer!'),
        // isOverlapping(placementLayers, 2, 'Overlapping other area!','Your area is overlapping someone elses, plz fix <3'),
        // isOverlappingOrContained(groups.slope, 1, 'Slope warning!','Your area is in slopey or uneven terrain, make sure to check the slope map layer to make sure that you know what you are doing :)'),
        // isOverlappingOrContained(groups.fireroad, 3, 'Touching fireroad!','Plz move this area away from the fire road!'),
        // isNotInsideBoundaries(groups.propertyborder, 3, 'Outside border!','You have placed yourself outside our land, please fix that <3'),
        // isInsideBoundaries(groups.hiddenforbidden, 3, 'Inside forbidden zone!', 'You are inside a zone that can not be used this year.'),
        //isBufferOverlappingRecursive(placementLayers, 3, 'Too large/close to others!','This area is either in itself too large, or too close to other areas. Make it smaller or move it further away.'),
        // isNotInsideBoundaries(groups.highprio, 2, 'Outside placement areas.', 'You are outside the main placement area (yellow border). Make sure you know what you are doing.'),
    ];
}

const hasManyCoordinates = () =>
    new Rule(1, 'Many points.', 'You have added many points to this shape. Bear in mind that you will have to set this shape up in reality as well.', (entity) => {
        const geoJson = entity.toGeoJSON();
        //Dont know why I have to use [0] here, but it works
        return {triggered: geoJson.geometry.coordinates[0].length > MAX_POINTS_BEFORE_WARNING};
    });

const hasLargeEnergyNeed = () =>
    new Rule(1, 'Powerful.', 'You need a lot of power, make sure its not a typo.', (entity) => {
        return {triggered: entity.powerNeed > MAX_POWER_NEED};
    });

const hasMissingFields = () =>
    new Rule(2, 'Missing info', 'Fill in name, description, contact info, power need and sound amplification please.', (entity) => {
        return {triggered: !entity.name || !entity.description || !entity.contactInfo || entity.powerNeed === -1 || entity.amplifiedSound === -1};
    });

const isCalculatedAreaTooBig = () =>
    new Rule(3, 'Too many ppl/vehicles!', 'Calculated area need is bigger than the maximum allowed area size! Make another area to fix this.', (entity) => {
        return {triggered: entity.calculatedAreaNeeded > MAX_CLUSTER_SIZE};
    });

const isBiggerThanNeeded = () =>
    new Rule(2, 'Bigger than needed?', 'Your area is quite big for the amount of people/vehicles and extras you have typed in.', (entity) => {
        
        return {triggered: entity.area > calculateReasonableArea(entity.calculatedAreaNeeded), message: `Your area is <b>${entity.area - entity.calculatedAreaNeeded}m² bigger</b> than the suggested area size. Consider making it smaller.`};
    });

function calculateReasonableArea(calculatedNeed: number): number {
  // Define constants for the power function
  const a = 0.5; // Controls the initial additional area
  const b = -0.2; // Controls the rate of decrease of the additional area

  // Calculate the additional area percentage using a power function
  const additionalArea = a * Math.pow(calculatedNeed, b);

  // Clamp the additional area between 0 and a
  const clampedAdditionalArea = Math.max(0, Math.min(additionalArea, a));

  // Calculate the allowed area
  const allowedArea = Math.min(calculatedNeed * (1 + clampedAdditionalArea), MAX_CLUSTER_SIZE);
  
  return allowedArea;
}

const isSmallerThanNeeded = () =>
    new Rule(
        1,
        'Too small.',
        'Considering the amount of people, vehicles and extras you have, this area is probably too small.',
        (entity) => {
            let calculatedNeed = entity.calculatedAreaNeeded;
            if (entity.area < calculatedNeed) {
                return { triggered: true, 
                    shortMessage: 'Too small.', 
                    message: `Considering the amount of people, vehicles and extras you have, this area is probably too small. Consider adding at least ${Math.ceil(calculatedNeed - entity.area)}m² more.`};
            }
            else {
                return { triggered: false };
            }
        }
    );

const isOverlapping = (layerGroup: any, severity: Rule["_severity"], shortMsg: string, message: string) =>
    new Rule(severity, shortMsg,message, (entity) => {
        return {triggered: _isGeoJsonOverlappingLayergroup(entity.toGeoJSON(), layerGroup) };
    });

const isOverlappingOrContained = (layerGroup: any, severity: Rule["_severity"], shortMsg: string, message: string) =>
    new Rule(severity, shortMsg,message, (entity) => {

        let geoJson = entity.toGeoJSON();
        let overlap = false;

        layerGroup.eachLayer((layer) => {
            //@ts-ignore
            let otherGeoJson = layer.toGeoJSON();

            //Loop through all features if it is a feature collection
            if (otherGeoJson.features) {
                for (let i = 0; i < otherGeoJson.features.length; i++) {
                    if (Turf.booleanOverlap(geoJson, otherGeoJson.features[i]) || Turf.booleanContains(otherGeoJson.features[i], geoJson)) {
                        overlap = true;
                        return; // Break out of the inner loop
                    }
                }
            } else if (Turf.booleanOverlap(geoJson, otherGeoJson) || Turf.booleanContains(otherGeoJson, geoJson)) {
                overlap = true;
            }

            if (overlap) {
                return; // Break out of the loop once an overlap is found
            }
        });

        return { triggered: overlap};
    });

const isInsideBoundaries = (layerGroup: any, severity: Rule["_severity"], shortMsg: string, message: string) =>
    checkEntityBoundaries(layerGroup, severity, shortMsg, message, true);

const isNotInsideBoundaries = (layerGroup: any, severity: Rule["_severity"], shortMsg: string, message: string) =>
    checkEntityBoundaries(layerGroup, severity, shortMsg, message, false);

const checkEntityBoundaries = (
    layerGroup: any,
    severity: Rule["_severity"],
    shortMsg: string,
    message: string,
    shouldBeInside: boolean
    ) =>
        new Rule(severity, shortMsg, message, (entity) => {
            const layers = layerGroup.getLayers();

            for (const layer of layers) {
                let otherGeoJson = layer.toGeoJSON();

                // Loop through all features if it is a feature collection
                if (otherGeoJson.features) {
                    for (let i = 0; i < otherGeoJson.features.length; i++) {
                        if (Turf.booleanContains(otherGeoJson.features[i], entity.toGeoJSON())) {
                            return {triggered: shouldBeInside};
                        }
                    }
                } else if (Turf.booleanContains(otherGeoJson, entity.toGeoJSON())) {
                    return {triggered: shouldBeInside};
                }
            }

            return {triggered: !shouldBeInside};
        });

/** Utility function to calculate the ovelap between a geojson and layergroup */
function _isGeoJsonOverlappingLayergroup(
    geoJson: Turf.helpers.Feature<any, Turf.helpers.Properties> | Turf.helpers.Geometry,
    layerGroup: L.GeoJSON,
): boolean {
    //NOTE: Only checks overlaps, not if its inside or covers completely

    let overlap = false;
    layerGroup.eachLayer((layer) => {
        //@ts-ignore
        let otherGeoJson = layer.toGeoJSON();

        //Loop through all features if it is a feature collection
        if (otherGeoJson.features) {
            for (let i = 0; i < otherGeoJson.features.length; i++) {
                if (Turf.booleanOverlap(geoJson, otherGeoJson.features[i])) {
                    overlap = true;
                    return; // Break out of the inner loop
                }
            }
        } else if (Turf.booleanOverlap(geoJson, otherGeoJson)) {
            overlap = true;
        }

        if (overlap) {
            return; // Break out of the loop once an overlap is found
        }
    });

    return overlap;
}

const layersGraph:{[id: number] : Set<number>;} = {}
const areaCache = {}

const getLayerPolygon = (layer:L.Layer)=>{
    //@ts-ignore
    const layerGeoJSON = layer.toGeoJSON();
    let layerPolygon;
    if (layerGeoJSON.type === 'Feature') {
        layerPolygon = layerGeoJSON.geometry;
    } else if (layerGeoJSON.type === 'FeatureCollection') {
        layerPolygon = layerGeoJSON.features[0];
    } else {
        // Unsupported geometry type
        throw new Error("Unsupported geometry type");
    }
    return layerPolygon
}

const getOverlappingLayerIds  = (layer:L.Layer, layerGroup:any):Set<number> => {
    const overlappingLayersIDs =  new Set<number>();



    //@ts-ignore
    let buffer = Turf.buffer(layer.toGeoJSON(), FIRE_BUFFER_IN_METER, { units: 'meters' }) as Turf.helpers.FeatureCollection<Turf.helpers.Polygon>;

    layerGroup.eachLayer((otherLayer) => {
        // check area is cached for each layer
        if(!(otherLayer._leaflet_id in areaCache)){

        }
        if (!_compareLayers(layer, otherLayer))
        {
            
            const otherLayerPolygon = getLayerPolygon(otherLayer)

            //@ts-ignore
            if (Turf.booleanOverlap(buffer.features[0], otherLayerPolygon)) { //&& !checkedOverlappingLayers.has(otherLayer._leaflet_id)
                overlappingLayersIDs.add(otherLayer._leaflet_id)
            }
        }
        
    });

    return overlappingLayersIDs;
}

const deleteLayerFromCache = (layerID:number)=>{
    delete areaCache[layerID]
    delete layersGraph[layerID]
    for (let id of Object.keys(layersGraph)){
        layersGraph[id].delete(layerID)
    }
}



const deleteFromAreaCache  = (layerGroup:any) => {

    // delete 
    for(let layerID of Object.keys(layersGraph)){
     
        if (!layerGroup.getLayer(layerID)){
            console.log("DELETING")
            deleteLayerFromCache(Number(layerID));
            
        }
    }
}

let hasRunOnce = false;
const runOneTimeUpdateGraph = (layerGroup:any)=>{
    layerGroup.eachLayer(function(layer){ 
        const overlappingLayersIDs: Set<number>= getOverlappingLayerIds(layer,layerGroup) //leaflet_ids of overlapping layers
        print(layer,null,"ovrelapping layers" + Array.from(overlappingLayersIDs),null)
        updateLayerGraph(layer._leaflet_id,overlappingLayersIDs,false)
    });
    //console.log('Map has', i, 'layers. and tinier: ', tiny);

    
}
const updateLayerGraph = (layerID:number,connLayersIDs:Set<number>,del:any)=>{

    if (!(layerID in layersGraph)){
        layersGraph[layerID] = new Set<number>();
    }
    let prevConnLayersIDs = layersGraph[layerID]; // previously connected layers

    const idsToDelete:Set<number> = new Set<number>();
    const idsToCreate:Set<number> = new Set<number>();
    // Using Set.difference is easier but apparently not supported in all browsers

   
    //@ts-ignore
    for(let id of prevConnLayersIDs){
        if (!(connLayersIDs.has(id))){
            idsToDelete.add(id)
        }
    }
    //@ts-ignore
    for(let id of connLayersIDs){
        if (!(prevConnLayersIDs.has(id))){
            idsToCreate.add(id)
        }
    }
 
    // go through all layers that previously was connected to current layer and remove current layer
    
    if (del){
        console.log("prevconn ", Array.from(prevConnLayersIDs)," for ", layerID)
        console.log("thisconn ", Array.from(connLayersIDs)," for ", layerID)
        console.log("deleting ", Array.from(idsToDelete)," for ", layerID)
        console.log("deleting ", Array.from(idsToDelete)," for ", layerID)
        //@ts-ignore
    for (let id of idsToDelete){
        layersGraph[id].delete(layerID)
        layersGraph[layerID].delete(Number(id))
    }
    console.log("creating ", Array.from(idsToCreate)," for ", layerID)
    }   
    //@ts-ignore
    for (let id of idsToCreate){
        if (!(id in layersGraph)){
            layersGraph[id] = new Set<number>();
        }
        layersGraph[id].add(layerID)
        layersGraph[layerID].add(Number(id))
    }
    let k=""
    Object.keys(layersGraph).forEach((x)=>{k+=` ${x},`})
    //console.log(k)
    
}

const getAreaFromCache = (layerID:number,layerGroup: L.LayerGroup):number =>{
    // returns cached area and creates cachedarea if does not exist

    if(!(layerID in areaCache)){
        
        let layer = layerGroup.getLayer(layerID)
        if(layer){
            //@ts-ignore
            areaCache[layerID] = Turf.area(layer.toGeoJSON())
        }
        else{
            throw new Error("Layer not found")
        }
    }
    return areaCache[layerID]
}
function _recursiveGetTotalArea(layerID: number, layerGroup: L.LayerGroup, checkedLayerIDs: Set<number>): number {
    //@ts-ignore
    if (checkedLayerIDs.has(layerID))
    {
        return 0;
    }
    else
    {
        //@ts-ignore
        checkedLayerIDs.add(layerID);
    }
    
    //@ts-ignore
    let totalArea = getAreaFromCache(layerID,layerGroup)
    print(null,layerID,`Layers to check:  ${Array.from(layersGraph[layerID])} `,layerGroup)
    //@ts-ignore
    for (let otherLayerID:number of layersGraph[layerID] ){
        
        totalArea += _recursiveGetTotalArea(otherLayerID,layerGroup,checkedLayerIDs);
        print(null,layerID,`added total area ${totalArea} for layerID ${layerID} and othrelayerID ${otherLayerID}`,layerGroup);
    }
    print(null,layerID,`returning total area ${totalArea} for layerID ${layerID}`,layerGroup);
    return totalArea;
}

const print = (layer:any,layerID:any,text:any,layerGroup:any)=>{
 return;
    if (layer === null){
        layer = layerGroup.getLayer(layerID)
    }
    const desc = layer._layers[Object.keys(layer._layers)[0]].feature.properties.description
    const name = layer._layers[Object.keys(layer._layers)[0]].feature.properties.name
    
    if (name == "Tinier Camp"){
        console.log(`${name} : ${text}`)
    }
    
    if (desc == "test"){
        console.log(`${layer._leaflet_id} : ${text}`)
    }
}
let pik = 0
const logg = (logTrue,text)=>{
if (logTrue ) console.log(text)
}
const fastOverlap = (layerGroup: any, severity: Rule["_severity"], shortMsg: string, message: string) =>
    new Rule(severity, shortMsg, message, (entity) => {
        if(!hasRunOnce){
            hasRunOnce=true;
            //runOneTimeUpdateGraph(layerGroup);
        }
        pik++
        //console.log("pik called ", pik, " times")
        
        const layer = entity.layer
        //@ts-ignore
        const name = layer._layers[Object.keys(layer._layers)[0]].feature.properties.name
        let logTrue = name === "Tinier Camp"
  
        //@ts-ignore
        const layerGeoJSON = layer.toGeoJSON();
        //@ts-ignore
        const layerID:number = layer._leaflet_id;
        //console.log(layer)
        //@ts-ignore
        //print(null,layerID,`added total area ${totalArea} for layerID ${layerID} and othrelayerID ${otherLayerID}`,layerGroup);
        print(null,layerID,"fastoverlap",layerGroup)
        //console.log("running fast overlap for "+layerID)
        deleteFromAreaCache(layerGroup)
        //console.log(Object.keys(areaCache).length)
        let i = 0;
        let tiny = 0
        layerGroup.eachLayer(function(x){ 
            i += 1; 
            //@ts-ignore
            //console.log(x)
            const name = x._layers[Object.keys(x._layers)[0]].feature.properties.name
            if (name == "Tinier Camp"){
                tiny++;
            }
        });
        //console.log('Map has', i, 'layers. and tinier: ', tiny);

        const overlappingLayersIDs: Set<number>= getOverlappingLayerIds(layer,layerGroup) //leaflet_ids of overlapping layers
        print(layer,null,"ovrelapping layers" + Array.from(overlappingLayersIDs),null)
        updateLayerGraph(layerID,overlappingLayersIDs,true)
        print(layer,null,"layergraph" + Array.from(overlappingLayersIDs),null)

        // update area for this layer
        //areaCache[layerID] = Turf.area(layerGeoJSON);
        const checkedLayerIDs: Set<number> = new Set<number>();
        let totalArea = _recursiveGetTotalArea(layerID, layerGroup, checkedLayerIDs);
        print(layer,null,`found total area ${totalArea}`,null)
        logg(logTrue,`found total area ${totalArea}`)
        logg(logTrue,`Using${Array.from(checkedLayerIDs)}`)
        print(layer,null,`found total area ${totalArea}`,null)
        //print(layer,null,`area of layer ${getAreaFromCache(layerID,layerGroup)}`,null)
        if ( totalArea > MAX_CLUSTER_SIZE) {
            return {triggered: true, shortMessage: `Cluster too big: ${Math.round(totalArea).toString()}m²`};
        }
        return {triggered: false};
    });

const isBufferOverlappingRecursive = (layerGroup: any, severity: Rule["_severity"], shortMsg: string, message: string) =>
    new Rule(severity, shortMsg, message, (entity) => {
        const checkedOverlappingLayers = new Set<string>();
        
        let totalArea = _getTotalAreaOfOverlappingEntities(entity.layer, layerGroup, checkedOverlappingLayers);

        if ( totalArea > MAX_CLUSTER_SIZE) {
            return {triggered: true, shortMessage: `Cluster too big: ${Math.round(totalArea).toString()}m²`};
        }
        return {triggered: false};
    });

function _getTotalAreaOfOverlappingEntities(layer: L.Layer, layerGroup: L.LayerGroup, checkedOverlappingLayers: Set<string>): number {

    //@ts-ignore
    console.log(`rule for ${layer._leaflet_id}`)
   
    //@ts-ignore
    if (checkedOverlappingLayers.has(layer._leaflet_id))
    {
        return 0;
    }
    else
    {
        //@ts-ignore
        checkedOverlappingLayers.add(layer._leaflet_id);
    }
    
    //@ts-ignore
    let totalArea = Turf.area(layer.toGeoJSON());
    
    //@ts-ignore
    let buffer = Turf.buffer(layer.toGeoJSON(), FIRE_BUFFER_IN_METER, { units: 'meters' }) as Turf.helpers.FeatureCollection<Turf.helpers.Polygon>;

    layerGroup.eachLayer((otherLayer) => {
        if (!_compareLayers(layer, otherLayer))
        {
            //@ts-ignore
            const otherLayerGeoJSON = otherLayer.toGeoJSON();
            let otherLayerPolygon;
            if (otherLayerGeoJSON.type === 'Feature') {
                otherLayerPolygon = otherLayerGeoJSON.geometry;
            } else if (otherLayerGeoJSON.type === 'FeatureCollection') {
                otherLayerPolygon = otherLayerGeoJSON.features[0];
            } else {
                // Unsupported geometry type
                return;
            }

            //@ts-ignore
            if (Turf.booleanOverlap(buffer.features[0], otherLayerPolygon)) { //&& !checkedOverlappingLayers.has(otherLayer._leaflet_id)
                //@ts-ignore
                totalArea += _getTotalAreaOfOverlappingEntities(otherLayer, layerGroup, checkedOverlappingLayers);
                return;
            }
        }
    });

    return totalArea;
}

function _compareLayers(layer1: L.Layer, layer2: L.Layer): boolean {
    //@ts-ignore
    return layer1._leaflet_id === layer2._leaflet_id;
}

const isBreakingSoundLimit = (layerGroup: any, severity: Rule["_severity"], shortMsg: string, message: string) =>
    new Rule(severity, shortMsg,message, (entity) => {

        if (entity.amplifiedSound === undefined) return {triggered: false};
        
        let geoJson = entity.toGeoJSON();
        let overlap = false;

        layerGroup.eachLayer((layer) => {
            //@ts-ignore
            let otherGeoJson = layer.toGeoJSON();
            let limitQuiet = 10;
            let limitLow = 120;
            let limitMediumLow = 2000;
            let limitMedium = 2000;
            
            //Loop through all features if it is a feature collection
            if (otherGeoJson.features) {
                for (let i = 0; i < otherGeoJson.features.length; i++) {
                    if (Turf.booleanOverlap(geoJson, otherGeoJson.features[i]) || Turf.booleanContains(otherGeoJson.features[i], geoJson)) {
                        if (otherGeoJson.features[i].properties.type == "soundquiet" && entity.amplifiedSound > limitQuiet) {
                            overlap = true;
                            return; 
                        } else if (otherGeoJson.features[i].properties.type == "soundlow" && entity.amplifiedSound > limitLow) {
                            overlap = true;
                            return; 
                        } else if (otherGeoJson.features[i].properties.type == "soundmediumlow" && entity.amplifiedSound > limitMediumLow) {
                            overlap = true;
                            return; 
                        } else if (otherGeoJson.features[i].properties.type == "soundmedium" && entity.amplifiedSound > limitMedium) {
                            overlap = true;
                            return; 
                        }
                    }
                }
            } else if (Turf.booleanOverlap(geoJson, otherGeoJson) || Turf.booleanContains(otherGeoJson, geoJson)) {
                if (otherGeoJson.properties.type == "soundquiet" && entity.amplifiedSound > limitQuiet) {
                    overlap = true;
                    return; 
                } else if (otherGeoJson.properties.type == "soundlow" && entity.amplifiedSound > limitLow) {
                    overlap = true;
                    return; 
                } else if (otherGeoJson.properties.type == "soundmediumlow" && entity.amplifiedSound > limitMediumLow) {
                    overlap = true;
                    return; 
                } else if (otherGeoJson.properties.type == "soundmedium" && entity.amplifiedSound > limitMedium) {
                    overlap = true;
                    return; 
                }
            }

            if (overlap) {
                return; // Break out of the loop once an overlap is found
            }
        });

        return { triggered: overlap};
    });
