import * as k8s from '@pulumi/kubernetes'
import * as pulumi from '@pulumi/pulumi'
import * as config from './config'


export interface NginxIngressArgs {
  version?: pulumi.Input<string>,
  namespace?: pulumi.Input<string>,
  serviceType?: pulumi.Input<string>,
  ingressClass?: pulumi.Input<string>,
  nodePortHTTP?: pulumi.Input<number>,
  nodePortHTTPS?: pulumi.Input<number>,
  replicaCount?: pulumi.Input<number>,
  useProxyProtocol?: pulumi.Input<string>,
  useForwardedHeaders?: pulumi.Input<string>,
  clientMaxBodySize?: pulumi.Input<string>,
  deploymentKind?: pulumi.Input<string>,
  serviceAnnotations?: pulumi.Input<object>,
  realIpFromCloudflare?: pulumi.Input<boolean>,
  enableServiceMonitor?: pulumi.Input<boolean>,
  serviceMonitorNamespace?: pulumi.Input<string>,
}

export class NginxIngress extends pulumi.ComponentResource  {
  constructor(
    appName: string,
    args: NginxIngressArgs,
    opts?: pulumi.ComponentResourceOptions,
  ) {
    
    super(appName, appName, {}, opts)

    const version = args.version || config.version
    const namespace = args.namespace || config.namespace
    const serviceType = args.serviceType || config.serviceType
    const ingressClass = args.ingressClass || config.ingressClass
    const nodePortHTTP = args.nodePortHTTP || config.nodePortHTTP
    const nodePortHTTPS = args.nodePortHTTPS || config.nodePortHTTPS
    const replicaCount = args.replicaCount || config.replicaCount || 1
    const useProxyProtocol = args.useProxyProtocol || config.useProxyProtocol || "false"
    const useForwardedHeaders = args.useForwardedHeaders || config.useForwardedHeaders || "true"
    const clientMaxBodySize = args.clientMaxBodySize || config.clientMaxBodySize
    const deploymentKind = args.deploymentKind || "DaemonSet"
    const serviceAnnotations = args.serviceAnnotations || {}
    const realIpFromCloudflare = args.realIpFromCloudflare || false
    const enableServiceMonitor = args.enableServiceMonitor || false
    const serviceMonitorNamespace = args.serviceMonitorNamespace || "cattle-prometheus"

    let server_snippet = "";

    if (realIpFromCloudflare) {
      server_snippet = "real_ip_header CF-Connecting-IP;"
    }

    let useHostPort: boolean = true
    let hostNetwork: boolean = true
    let externalTrafficPolicy: string = ""
    let nodePorts;

    const ns = new k8s.core.v1.Namespace(
      `${appName}-ns`,
      {
        metadata: {
          name: namespace,
        },
      },
      { parent: this },
    )    

    let dependsOn = [ns]
    
    // if (enableServiceMonitor) {
    //   const serviceMonitorNs = new k8s.core.v1.Namespace(
    //     `${appName}-serviceMonitorNamespace`,
    //     {
    //       metadata: {
    //         name: serviceMonitorNamespace,
    //       },
    //     },
    //     { parent: this },
    //   )        

    //   dependsOn = [
    //     ns,
    //     serviceMonitorNs
    //   ]
    // }

    

    switch (serviceType) {
      case "ClusterIP":
        
        break;

      case "NodePort":
        useHostPort = false
        hostNetwork = false
        externalTrafficPolicy = "Local"
        nodePorts = {
          http: nodePortHTTP,
          https: nodePortHTTPS
        }

        break;
      
      case "LoadBalancer":
        useHostPort = false
        hostNetwork = false
        externalTrafficPolicy = "Local"
          
        break;        
    
      default:
        break;
    }

    const nginxIngress = new k8s.helm.v3.Chart(
      appName,
      {
        chart: "nginx-ingress",
        version: version,
        fetchOpts: {
          repo: 'https://kubernetes-charts.storage.googleapis.com',
        },
        namespace: namespace,
        values: {
          controller: {
            kind: deploymentKind,
            replicaCount: replicaCount,
            service: {
              type: serviceType,
              externalTrafficPolicy: externalTrafficPolicy,
              nodePorts: nodePorts,
              annotations: serviceAnnotations
            },
            ingressClass: ingressClass,
            daemonset: {
              useHostPort: useHostPort,
            },
            hostNetwork: hostNetwork,
            metrics: {
              enabled: true,
              service: {
                type: "ClusterIP",
                annotations: {
                  "prometheus.io/scrape": "true",
                  "prometheus.io/port": "10254"
                }
              },
              serviceMonitor: {
                enabled: enableServiceMonitor,
                scrapeInterval: "10s",
                namespaceSelector: {
                  any: true
                },
                namespace: serviceMonitorNamespace,
                // additionalLabels: {
                //   release: "prometheus-operator"
                // }
              }
            },
          }
        }
      },
      {
        parent: this,
        dependsOn: dependsOn,
      },
    )    

    const configMap = new k8s.core.v1.ConfigMap(`${appName}-config-map`, {
      metadata: {
        namespace: namespace,
        name: `${appName}-controller`
      },      
      data: {
        "use-proxy-protocol": useProxyProtocol,
        "use-forwarded-headers": useForwardedHeaders,
        "client-max-body-size": clientMaxBodySize,
        "http-redirect-code": "301",
        "map-hash-bucket-size": "128", 
        "proxy-buffer-size": "8k",
        "proxy-buffers": "4 8k",
        "enable-brotli": "true",
        "ssl-protocols": "TLSv1.3 TLSv1.2",
        "enable-ocsp": "true",
        "no-tls-redirect-locations": "/.well-known/acme-challenge,/verification",
        "server-snippet": server_snippet
      }
    },
    {
      parent: this,
      dependsOn: [
        nginxIngress,
      ],
    })
  }
}