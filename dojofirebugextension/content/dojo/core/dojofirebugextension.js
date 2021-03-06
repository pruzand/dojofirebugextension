/* Released under BSD license (see license.txt) */
/*
 * Copyright IBM Corporation 2010, 2010. All Rights Reserved. 
 * U.S. Government Users Restricted Rights -  Use, duplication or disclosure restricted by GSA ADP 
 * Schedule Contract with IBM Corp. 
 */


/**
 * Firebug dojo extension main file.
 * @author preyna@ar.ibm.com
 * @author fergom@ar.ibm.com
 */
define([
        "firebug/firebug",
        "firebug/lib/dom",
        "firebug/lib/events",
        "firebug/lib/object",
        "firebug/lib/trace",
        "dojo/core/dojoaccess",
        "dojo/core/dojodebugger",
        "dojo/core/dojomodel",
        "dojo/core/dojohooks",
        "dojo/core/prefs",
        "dojo/core/proxies",  
        "dojo/lib/collections",
        "dojo/lib/utils"
       ], function dojoModuleFactory(Firebug, Dom, Events, Obj, FBTrace, DojoAccess, DojoDebug, DojoModel, 
               DojoHooks, DojoPrefs, DojoProxies, Collections, DojoUtils)
{

// ****************************************************************
// GLOBAL FUNCTIONS IN THIS NAMESPACE
// ****************************************************************

    
    var DojoExtension = {};
    
    /**
     * returns the DojoAccessor service.
     */
    var getDojoAccessor = DojoExtension.getDojoAccessor = function(context) {
        var service = DojoAccess.getImpl(context);
        return service;
    };
    
    /**
     * returns the DojoDebugger service.
     */
    var getDojoDebugger = DojoExtension.getDojoDebugger = function(context) {
        var service = DojoDebug.getImpl(context);        
        return service;
    };

    /**
     * returns the current context.
     */
    /*context*/DojoExtension.safeGetContext = function(panel) {
        var ctx = panel.context;
        if(!ctx) {
            ctx = Firebug.currentContext;
        }
        return ctx;
    };

    var setNeedsReload = DojoExtension.setNeedsReload = function(context, flag) {
        context.needReload = flag;
    };
    
    DojoExtension.needsReload = function(context) {
        return context.needReload;
    };
    

//****************************************************************
// DOJO MODULE
//****************************************************************
/**
 * @module Dojo Firebug extension module.
 */
DojoExtension.dojofirebugextensionModel = Obj.extend(Firebug.ActivableModule,
{
    dispatchName: "dojofirebugextension",
    extensionLoaded: false, //if the extension has already registered its stuff.
    
    _getDojoPanel: function(context) {
        //(multi-process) Module shouldn't access the panel directly. This won't work in remote versions
        return context.getPanel("dojofirebugextension");
    },
        
    initialize: function() {
        Firebug.ActivableModule.initialize.apply(this, arguments);
        
        if(this.isExtensionEnabled()) {
            this.enableExtension();  
        }
    },
    
    shutdown: function() {
        Firebug.ActivableModule.shutdown.apply(this, arguments);        
    },
        
    initContext: function(context, persistedState) {
        Firebug.ActivableModule.initContext.apply(this, arguments);
        
        // Save extension's initial preferences values.
        context.initialConfig = {
                hashCodeBasedDictionaryImplementationEnabled: DojoPrefs._isHashCodeBasedDictionaryImplementationEnabled(),
                breakPointPlaceSupportEnabled: !DojoPrefs._isBreakPointPlaceSupportDisabled(),
                useEventBasedProxy: DojoPrefs._isUseEventBasedProxyEnabled()
        };
        
        context.objectMethodProxier = (DojoPrefs._isUseEventBasedProxyEnabled()) ?
                                        new DojoProxies.ObjectMethodProxierEventBased(context) : 
                                        new DojoProxies.ObjectMethodProxierDirectAccessBased();

                                        
        if(!context.dojo) {
            DojoAccess.initContext(context);
            DojoDebug.initContext(context);
            DojoHooks.initContext(context);
        }
        context.tracker = new DojoModel.Tracker(DojoPrefs._isHashCodeBasedDictionaryImplementationEnabled());        
        
        // HACK to find out if the page need to be reloaded due to data inconsistencies issues.
        var dojo = DojoAccess._dojo(context);
        setNeedsReload(context, (dojo && dojo["subscribe"]));
        
        //TODO this invocation could be in a better place. Here it will be only evaluated when reloading a page. 
        this._checkPanelActivationPrerequisites(context);
    },

    /**
     * Called after a context's page gets DOMContentLoaded
     */
    loadedContext: function(context) {
        if(context.showInitialViewCall) {
            //dojo.ready was registered. We don't need to do this.
            return;
        }
        
        //TODO here use fbListeners to decouple from main panel
        var panel = this._getDojoPanel(context);
        
        if (panel) {
            // Show the initial view.
            panel.showInitialView(context);
        }
        
    },
    
    _checkPanelActivationPrerequisites: function(context) {
        var console = Firebug.PanelActivation.isPanelEnabled(Firebug.getPanelType("console"));
        var script = Firebug.PanelActivation.isPanelEnabled(Firebug.getPanelType("script"));
        if(!console || !script) {
            context.dojoPanelReqsNotMet = true;
        }
    },
    
    destroyContext: function(context, persistedState) {
        Firebug.ActivableModule.destroyContext.apply(this, arguments);
  
        //destroy what we created on initContext
        context.tracker.destroy();
        context.objectMethodProxier.destroy();
        
        DojoAccess.destroyInContext(context);
        DojoDebug.destroyInContext(context);
        DojoHooks.destroyInContext(context);
        
        delete context.tracker;
    },
            
    /**
     * invoked whenever the user selects a tab.
     */
    showPanel: function(browser, panel) {
        //(multi-process) is this code right (to be here)?
        
        // this test on name is a sign that this code belongs in panel.show()
        var isdojofirebugextensionPanel = panel && panel.name == "dojofirebugextension";
        if(!browser || !browser.chrome) {
            return;
        }
        
        var dojofirebugextensionButtons = browser.chrome.$("fbDojo_firebugextensionButtons");
        if(dojofirebugextensionButtons) {
            Dom.collapse(dojofirebugextensionButtons, !isdojofirebugextensionPanel);
        }
    },

    //fbug 1.8 compatible
    /**
     * called on each dojo file loaded (actually for every file).
     * This way, we can detect when dojo.js is loaded and take action. 
     */
    onCompilationUnit: function (context, url, kind) {
        var panelIsEnable = this.isExtensionEnabled();
        
        if (panelIsEnable) {
           var href = url;
          
           if(FBTrace.DBG_DOJO_DBG) {
               FBTrace.sysout("onCompilationUnit: " + href);
           }
           
           
           var dojo = DojoAccess._dojo(context);
           var dojoAccessor = getDojoAccessor(context);
           var dojoDebugger = getDojoDebugger(context);
           
           if (dojo) {
               var startupHooks = DojoHooks.getImpl(context, dojo.version);
               try {
                   startupHooks.onCompilationUnit(context, url, kind, dojo, context.objectMethodProxier, dojoAccessor, dojoDebugger, context.tracker);
               } catch (error) {
                   if(FBTrace.DBG_DOJO) {
                       FBTrace.sysout(error);
                   }                   
               }
           }
                                         
           //register a dojo.ready callback
           if(!context.showInitialViewCall && dojo && (dojo.ready || dojo.addOnLoad)) {
               var showInitialViewCall = context.showInitialViewCall = function showInitialView() {
                  //FIXME this is a hack . We are accessing our UIs directly 
                   var panel = DojoExtension.dojofirebugextensionModel._getDojoPanel(context);                    
                   if (panel) {
                       // Show the initial view.                       
                       panel.showInitialView(context);
                   }                   
                   var gfxPanel = context.getPanel("dojofirebugextension_GFX");                                       
                   if (gfxPanel) {
                       gfxPanel.showInitialView(context);
                   }

                };
               DojoUtils._addMozillaExecutionGrants(showInitialViewCall);               
               //dojo.addOnLoad
               var dojoReadyFn = dojo.ready || dojo.addOnLoad;
               dojoReadyFn.call(dojo, showInitialViewCall);
           }
                               
       }

    },
    
   
   // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
   // Activation logic
   
   onObserverChange: function(observer) {
       if(FBTrace.DBG_DOJO) {
           FBTrace.sysout("DOJO - onObserverChange");
       }

       Firebug.ActivableModule.onObserverChange.apply(this, arguments);
       
       if(!this.hasObservers()) {
           this.disableExtension();
       } else {
           this.enableExtension();
       }
   },
   
   isExtensionEnabled: function() {
       return DojoPrefs.isExtensionEnabled();
   },
   
   enableExtension: function() {
       if(this.extensionLoaded) {
           return;
       }

       if(FBTrace.DBG_DOJO) {
           FBTrace.sysout("DOJO - enableExtension");
       }

       if (this.isExtensionEnabled() && Firebug.connection) {
           if(FBTrace.DBG_DOJO) {
               FBTrace.sysout("DOJO - adding arch/browser listener");
           }           
           Firebug.connection.addListener(this);
       }

       if(FBTrace.DBG_DOJO) {
           FBTrace.sysout("DOJO - about to dispatch onDojoExtensionEnabled to fbListeners");
       }
       Events.dispatch(this.fbListeners, "onDojoExtensionEnabled");
       
       //last step
       this.extensionLoaded = true;
   },
   
   disableExtension: function() {
       //(multi-process) probably will need to fire event and execute this on UI side
       if(!this.extensionLoaded) {
           return;
       }

       if(FBTrace.DBG_DOJO) {
           FBTrace.sysout("DOJO - disableExtension");
       }

       if(FBTrace.DBG_DOJO) {
           FBTrace.sysout("DOJO - about to dispatch onDojoExtensionDisabled to fbListeners");
       }
       Events.dispatch(this.fbListeners, "onDojoExtensionDisabled");
              
       if (Firebug.connection) {
           if(FBTrace.DBG_DOJO) {
               FBTrace.sysout("DOJO - removing arch/browser listener");
           }           
           Firebug.connection.removeListener(this);
       }
              
       //last step
       this.extensionLoaded = false;
   },
   
   // * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
   // FBTest

   // Expose our test list to the FBTest console for automated testing.
   onGetTestList: function(testLists) {
       testLists.push({
           extension: "dojofirebugextension",
           //testListURL: "chrome://dojofirebugextension/content/fbtest/testlists/testList.html"
           testListURL: "http://testserver-alias/dojofirebugextension/content/fbtest/testlists/testList.html"
           //testListURL: "http://fbug.googlecode.com/svn/extensions/dojofirebugextension/trunk/dojofirebugextension/chrome/content/fbtest/testlists/testList.html"
       });
   }
   
   
});

/***********************************************************************************************************************/

Firebug.registerActivableModule(DojoExtension.dojofirebugextensionModel);
Firebug.DojoExtension = DojoExtension;

//$$HACK to make testUtils.js work
DojoExtension.Collections = Collections;
DojoExtension.DojoModel = DojoModel;

return DojoExtension;


});
