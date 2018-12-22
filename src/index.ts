import path from "path";
import fs from "fs";

import BundleSyntheticFile from "./stats";

const PLUGINID = "InitializeEntryPlugin";

interface BunchOf<T> { [key: string]: T }

export const toArray = <T> (value: T | Array<T>): Array<T> =>
    value ? Array.isArray(value) ? value : [value] : [];

module.exports = class InitializeEntryPlugin {

    context?: string;
    initEntries: string[];
    definedFiles: BunchOf<string>;
    importPassTo = {} as BunchOf<string>;
    test?: string;
    actualEntries = {} as BunchOf<any>;

    constructor(options: any){
        const { insert } = options;
        
        if(insert)
            this.initEntries = toArray(insert);
        else 
            throw new Error("This plugin needs an initializer { insert } in options to include!")

        this.test = options.test;
        this.definedFiles = options.define || {};
    }

    loadInitializerReplacements(){
        const context = this.context!;

        for(const insertable of this.initEntries){
            if(this.definedFiles[insertable]) return;

            const initFile = path.resolve(context, insertable)

            if (!fs.existsSync(initFile))
                throw new Error(`Initializer ${insertable} not found in ${context}!`)

            if (!fs.lstatSync(initFile).isFile())
                throw new Error(`Initializer ${initFile} found but is not a file!`)

            this.definedFiles[insertable] = fs.readFileSync(initFile, "utf-8");
        }
    }

    apply(compiler: any) {
        // after entry and context options are loaded into webpack
        compiler.hooks.entryOption.tap(PLUGINID, 
            (context: string, entries: any) => {

                this.context = context;
                this.loadInitializerReplacements();

                if(typeof entries !== "object" || Array.isArray(entries))
                    entries = { main: entries }
                    
                for(const x in entries){
                    const e = entries[x];
                    
                    this.actualEntries[x] = 
                        typeof e == "string" ? e :
                        Array.isArray(e) ?
                            e[e.length - 1] :
                            false;
                }
            })

        //gain access to module construction
        compiler.hooks.normalModuleFactory.tap(PLUGINID, (compilation: any) => {

            //when a module is requested, but before webpack looks for it in filesystem
            compilation.hooks.beforeResolve.tap(PLUGINID, (result: any) => {
                const target = result.dependencies[0]

                //when a module is requested by the program as an entry point, NOT via require or import.
                if (target.type == "single entry") {
                    let { loc } = target;

                    if(!loc) return result;

                    const name = typeof loc == "string"
                        ? loc.slice(0, loc.indexOf(":"))
                        : loc.name;

                    const replacableEntry = this.actualEntries[name];
                    
                    if(result.request == replacableEntry){
                        const initModule = replacableEntry.replace(/\.js$/, ".init.js");
                        const contents = this.definedFiles[this.initEntries[0]]!;

                        //create virtual entry replacement
                        BundleSyntheticFile(
                            compiler.inputFileSystem, 
                            path.join(this.context!, initModule), 
                            contents
                        );
                        //assign file as new entry for bundle
                        result.request = initModule;
                        //register virtual module's real-life counterpart 
                        this.importPassTo[initModule] = replacableEntry;
                    }
                }

                else if(result.request == "__webpack_entry__"){
                    const requestedBy = result.contextInfo.issuer;
                    const targetEntry = this.importPassTo["./" + path.relative(this.context!, requestedBy)];

                    if(!targetEntry)
                        throw new Error(`Module '__webpack_entry__' was requested by ${requestedBy} but that module is not an initializer!`)

                    result.request = path.join(this.context!, targetEntry);
                }
            
                return result;
            });
        });
    }
}